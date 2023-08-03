import { AndNode, BinaryOperationNode, ColumnNode, InsertQueryNode, JoinNode, KyselyPlugin, OperationNode, OperationNodeTransformer, OperatorNode, PluginTransformQueryArgs, PluginTransformResultArgs, ReferenceNode, SelectQueryNode, TableNode, UpdateQueryNode, ValueNode, WhereNode } from "kysely"
import { ValueOrFactory, callOrGet } from "value-or-factory"
import { TableMatcher, TableTests } from "./matcher"

export type DiscriminatedNode = InsertQueryNode | SelectQueryNode | UpdateQueryNode | JoinNode
export type Discriminator = { table: TableTests, columns: ValueOrFactory<Record<string, unknown>, [DiscriminatedNode]> }

export type DiscriminatorTransformerConfig = {
    discriminator: Discriminator
    throwOnUnsupported?: boolean
}

function maybe<I, O>(value: I | undefined | null, func: (value: I) => O) {
    if (value === undefined || value === null) {
        return undefined
    }
    return func(value)
}

export class DiscriminatorTransformer extends OperationNodeTransformer {

    private readonly matcher

    constructor(private readonly config: DiscriminatorTransformerConfig) {
        super()
        this.matcher = new TableMatcher(config.discriminator.table)
    }

    protected override transformInsertQuery(originalNode: InsertQueryNode): InsertQueryNode {
        const node = super.transformInsertQuery(originalNode)
        if (!this.matcher.test(node.into)) {
            return node
        }
        return {
            ...node,
            onConflict: (() => {
                if (node.onConflict === undefined) {
                    return
                }
                return {
                    ...node.onConflict,
                    columns: (() => {
                        if (node.onConflict.columns === undefined) {
                            return
                        }
                        const columns = Object.keys(callOrGet(this.config.discriminator.columns, node)).map(column => ColumnNode.create(column))
                        return [
                            ...node.onConflict.columns,
                            ...columns
                        ]
                    })()
                }
            })()
        }
    }

    //TODO updates
    //TODO joins

    private combineConditions(...conditions: (OperationNode | undefined)[]) {
        const filtered = conditions.filter((_): _ is OperationNode => _ !== undefined)
        if (filtered.length === 0) {
            return
        }
        return filtered.reduce((prev, current) => AndNode.create(prev, current))
    }
    private conditions(table: TableNode, node: DiscriminatedNode) {
        return Object.entries(callOrGet(this.config.discriminator.columns, node)).map(([column, value]) => {
            //TODO referencenode is backwards?
            // @ts-ignore
            return BinaryOperationNode.create(ReferenceNode.create(ColumnNode.create(column), table),
                OperatorNode.create("="),
                ValueNode.create(value))
        })
    }

    /*
    protected override transformJoin(originalNode: JoinNode) {
        const node = super.transformJoin(originalNode)
        const table = this.tableMatcher.testNode(node.table)
        if (table === undefined) {
            return node
        }
        const conditions = this.combineConditions(node.on?.on, ...this.conditions(table, node))
        return {
            ...node,
            on: maybe(conditions, on => OnNode.create(on))
        }
    }*/

    //TODO do
    protected override transformUpdateQuery(originalNode: UpdateQueryNode) {
        const node = super.transformUpdateQuery(originalNode)
        const table = this.matcher.testNode(node.table)
        if (table === undefined) {
            return node
        }
        const conditions = this.combineConditions(node.where?.where, ...this.conditions(table, node))
        return {
            ...node,
            where: maybe(conditions, WhereNode.create)
        }
    }
    protected override transformSelectQuery(originalNode: SelectQueryNode): SelectQueryNode {
        const node = super.transformSelectQuery(originalNode)
        const filters = node.from.froms.flatMap(from => {
            const table = this.matcher.testNode(from)
            if (table === undefined) {
                return []
            }
            return this.conditions(table, node)
        })
        console.log(filters)
        const conditions = this.combineConditions(node.where?.where, ...filters)
        return {
            ...node,
            where: maybe(conditions, WhereNode.create)
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
