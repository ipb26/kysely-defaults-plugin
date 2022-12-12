import { ColumnNode, ColumnUpdateNode, InsertQueryNode, KyselyPlugin, ListNodeItem, OperationNodeTransformer, PluginTransformQueryArgs, PluginTransformResultArgs, UpdateQueryNode, ValueExpressionNode, ValueNode, ValuesItemNode } from "kysely"
import { callOrGet, ValueOrFactory } from "value-or-factory"
import { TableMatch, TableMatcher } from "./matcher"

export type DefaultTable = { table: TableMatch | TableMatch[], columns: Record<string, DefaultColumn> }
export type DefaultColumn = [InsertDefault] | [InsertDefault, UpdateDefault] | { insert?: InsertDefault, update?: UpdateDefault, always?: UpdateDefault }
export type DefaultPrimitive = number | string | boolean | bigint | null
export type DefaultNode = ListNodeItem & ValueExpressionNode
export type DefaultValue<Q> = ValueOrFactory<DefaultNode | DefaultPrimitive, [Q]>
export type InsertDefault = DefaultValue<InsertQueryNode>
export type UpdateDefault = DefaultValue<InsertQueryNode | UpdateQueryNode>

export type DefaultsPluginOptions = {
    tables: DefaultTable[]
    throwOnUnsupported?: boolean
}

export default class DefaultsPlugin implements KyselyPlugin {

    private readonly transformers

    constructor(options: DefaultsPluginOptions) {
        this.transformers = options.tables.map(table => {
            return new DefaultsTransformer({
                table,
                throwOnUnsupported: options.throwOnUnsupported,
            })
        })
    }

    transformQuery(args: PluginTransformQueryArgs) {
        return this.transformers.reduce((node, transformer) => transformer.transformNode(node), args.node)
    }
    async transformResult(args: PluginTransformResultArgs) {
        return args.result
    }

}

type DefaultsTransformerOptions = {
    table: DefaultTable
    throwOnUnsupported?: boolean
}

class DefaultsTransformer extends OperationNodeTransformer {

    readonly tableMatcher

    constructor(private readonly options: DefaultsTransformerOptions) {
        super()
        this.tableMatcher = new TableMatcher(options.table.table)
    }

    private valueToNode<Q>(factory: DefaultValue<Q>, node: Q): DefaultNode {
        const value = callOrGet(factory, node)
        if (typeof value === "object" && value !== null) {
            return value
        }
        return {
            kind: "ValueNode",
            value
        }
    }
    private insertValues(node: InsertQueryNode) {
        return Object.entries(this.options.table.columns).flatMap(([key, config]) => {
            if (Array.isArray(config)) {
                if (config[0] === undefined) {
                    return []
                }
                return [[key, this.valueToNode(config[0], node)] as const]
            }
            const data = config.insert ?? config.always
            if (data === undefined) {
                return []
            }
            return [[key, this.valueToNode(data, node)] as const]
        })
    }
    private updateValues(node: InsertQueryNode | UpdateQueryNode) {
        return Object.entries(this.options.table.columns).flatMap(([key, config]) => {
            if (Array.isArray(config)) {
                if (config[1] === undefined) {
                    return []
                }
                return [[key, this.valueToNode(config[1], node)] as const]
            }
            const data = config.update ?? config.always
            if (data === undefined) {
                return []
            }
            return [[key, this.valueToNode(data, node)] as const]
        })
    }

    protected override transformUpdateQuery(originalNode: UpdateQueryNode): UpdateQueryNode {
        const node = super.transformUpdateQuery(originalNode)
        const table = (() => {
            if (node.table.kind === "TableNode") {
                return node.table.table
            }
            else {
                if (node.table.node.kind === "TableNode") {
                    return node.table.node.table
                }
                else {
                    if (this.options.throwOnUnsupported ?? false) {
                        throw new Error("This type of AliasNode is not supported by the DefaultsPlugin.")
                    }
                }
            }
        })()
        if (table === undefined) {
            return node
        }
        if (!this.tableMatcher.test(table.identifier.name, table.schema?.name)) {
            return node
        }
        const update = this.updateValues(node)
        return {
            ...node,
            updates: [
                ...node.updates ?? [],
                ...update.map<ColumnUpdateNode>(([key, value]) => {
                    return {
                        kind: "ColumnUpdateNode",
                        column: {
                            kind: "ColumnNode",
                            column: {
                                kind: "IdentifierNode",
                                name: key,
                            }
                        },
                        value
                    }
                })
            ]
        }
    }

    protected override transformInsertQuery(originalNode: InsertQueryNode): InsertQueryNode {
        const node = super.transformInsertQuery(originalNode)
        if (!this.tableMatcher.test(node.into.table.identifier.name, node.into.table.schema?.name)) {
            return node
        }
        if (node.values?.kind !== "ValuesNode") {
            if (this.options.throwOnUnsupported ?? true) {
                throw new Error("This type of ValuesNode is not supported by the DefaultsPlugin.")
            }
            return node
        }
        const insert = this.insertValues(node)
        const update = this.updateValues(node)
        return {
            ...node,
            onConflict: (() => {
                if (node.onConflict === undefined) {
                    return
                }
                return {
                    ...node.onConflict,
                    updates: [
                        ...node.onConflict.updates ?? [],
                        ...update.map<ColumnUpdateNode>(([key, value]) => {
                            return {
                                kind: "ColumnUpdateNode",
                                column: {
                                    kind: "ColumnNode",
                                    column: {
                                        kind: "IdentifierNode",
                                        name: key,
                                    }
                                },
                                value
                            }
                        })
                    ]
                }
            })(),
            columns: [
                ...node.columns ?? [],
                ...insert.map<ColumnNode>(([name]) => {
                    return {
                        kind: "ColumnNode",
                        column: {
                            kind: "IdentifierNode",
                            name,
                        }
                    }
                })
            ],
            values: {
                kind: "ValuesNode",
                values: [
                    ...node.values.values.map<ValuesItemNode>(list => {
                        return {
                            kind: "ValueListNode",
                            values: (() => {
                                const add = insert.map<ListNodeItem>(_ => _[1])
                                if (list.kind === "ValueListNode") {
                                    return [
                                        ...list.values,
                                        ...add
                                    ]
                                }
                                else {
                                    return [
                                        ...list.values.map<ValueNode>(value => {
                                            return {
                                                kind: "ValueNode",
                                                value
                                            }
                                        }),
                                        ...add
                                    ]
                                }
                            })()
                        }
                    })
                ]
            }
        }
    }

}
