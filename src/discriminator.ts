import { AndNode, BinaryOperationNode, ColumnNode, InsertQueryNode, KyselyPlugin, OperationNode, OperationNodeTransformer, OperatorNode, PluginTransformQueryArgs, PluginTransformResultArgs, ReferenceNode, SelectQueryNode, ValueNode } from "kysely"
import { callOrGet, ValueOrFactory } from "value-or-factory"
import { TableMatch, TableMatcher } from "./matcher"

export type Discriminator = { table: TableMatch, columns: ValueOrFactory<Record<string, unknown>, [InsertQueryNode | SelectQueryNode]> }

export type DiscriminatorTransformerConfig = {
    discriminator: Discriminator
    throwOnUnsupported?: boolean
}

export class DiscriminatorTransformer extends OperationNodeTransformer {

    private readonly tableMatcher

    constructor(private readonly config: DiscriminatorTransformerConfig) {
        super()
        this.tableMatcher = new TableMatcher(config.discriminator.table)
    }

    protected override transformInsertQuery(originalNode: InsertQueryNode): InsertQueryNode {
        const node = super.transformInsertQuery(originalNode)
        if (!this.tableMatcher.test(node.into)) {
            return node
        }
        if (node.values?.kind !== "ValuesNode") {
            if (this.config.throwOnUnsupported ?? true) {
                throw new Error("This type of ValuesNode is not supported by the DiscriminatorPlugin.")
            }
            return node
        }
        return {
            ...node,
            onConflict: (() => {
                if (node.onConflict === undefined) {
                    return
                }
                const newOnConflict = {
                    ...node.onConflict,
                    columns: [
                        ...node.onConflict.columns ?? [],
                        ...Object.entries(callOrGet(this.config.discriminator.columns, node)).map<ColumnNode>(([column]) => {
                            return ColumnNode.create(column)
                        })
                    ]
                }
                return newOnConflict
            })()
        }
    }

    protected override transformSelectQuery(originalNode: SelectQueryNode): SelectQueryNode {
        const node = super.transformSelectQuery(originalNode)
        const eqNodes = [
            ...node.from.froms.flatMap(from => {
                const table = this.tableMatcher.table(from)
                if (table === undefined) {
                    return []
                }
                if (!this.tableMatcher.test(table)) {
                    return []
                }
                return Object.entries(callOrGet(this.config.discriminator.columns, node)).map(([column, value]) => {
                    return BinaryOperationNode.create(
                        ReferenceNode.create(table, ColumnNode.create(column)),
                        OperatorNode.create("="),
                        ValueNode.create(value)
                    )
                })
            }),
        ]
        const filterNode = eqNodes.reduce<OperationNode | undefined>(
            (prev, current) => {
                if (prev === undefined) {
                    return current
                }
                return AndNode.create(prev, current)
            },
            node.where?.where
        )
        if (filterNode === undefined) {
            return node
        }
        else {
            return {
                ...node,
                where: {
                    kind: "WhereNode",
                    where: filterNode
                }
            }
        }
    }

}

export type DiscriminatorPluginOptions = { tables: Discriminator[], throwOnUnsupported?: boolean }

export class DiscriminatorPlugin implements KyselyPlugin {

    private readonly transformers

    constructor(options: DiscriminatorPluginOptions) {
        this.transformers = options.tables.map(discriminator => {
            return new DiscriminatorTransformer({ discriminator, throwOnUnsupported: options.throwOnUnsupported })
        })
    }

    transformQuery(args: PluginTransformQueryArgs) {
        return this.transformers.reduce((node, transformer) => transformer.transformNode(node), args.node)
    }
    async transformResult(args: PluginTransformResultArgs) {
        return args.result
    }

}
