import { ColumnNode, ColumnUpdateNode, InsertQueryNode, KyselyPlugin, ListNodeItem, OperationNodeTransformer, PluginTransformQueryArgs, PluginTransformResultArgs, UpdateQueryNode, ValueExpressionNode, ValueNode, ValuesItemNode } from "kysely"
import { callOrGet, ValueOrFactory } from "value-or-factory"

type TableMatcher = string | string[] | "*" | RegExp | ((table: string) => boolean)
type Primitive = number | string | boolean | bigint | null
type NodeValue = ListNodeItem & ValueExpressionNode
type NodeValueFactory<Q> = ValueOrFactory<NodeValue | Primitive, [Q]>
type InsertFactory = NodeValueFactory<InsertQueryNode>
type UpdateFactory = NodeValueFactory<InsertQueryNode | UpdateQueryNode>

export type DefaultsPluginOptions = {
    specs: DefaultSpec[]
    throwOnUnsupported?: boolean
}

export type DefaultSpec = {
    table: TableMatcher
    columns: Record<string, [InsertFactory] | [InsertFactory, UpdateFactory] | { insert?: InsertFactory, update?: UpdateFactory, always?: UpdateFactory }>
}

export default class DefaultsPlugin implements KyselyPlugin {

    private readonly transformers

    constructor(options: DefaultsPluginOptions) {
        this.transformers = options.specs.map(spec => {
            return new DefaultsTransformer({
                spec,
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
    spec: DefaultSpec
    throwOnUnsupported?: boolean
}

class DefaultsTransformer extends OperationNodeTransformer {

    constructor(private readonly options: DefaultsTransformerOptions) {
        super()
    }

    private valueToNode<Q>(factory: NodeValueFactory<Q>, node: Q): NodeValue {
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
        return Object.entries(this.options.spec.columns).flatMap(([key, config]) => {
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
        return Object.entries(this.options.spec.columns).flatMap(([key, config]) => {
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
    private includeTable(name: string) {
        if (this.options.spec.table === undefined) {
            return true
        }
        else if (typeof this.options.spec.table === "string") {
            return this.options.spec.table === name || this.options.spec.table === "*"
        }
        else if (this.options.spec.table instanceof RegExp) {
            return this.options.spec.table.test(name)
        }
        else if (typeof this.options.spec.table === "function") {
            return this.options.spec.table(name)
        }
        else {
            return this.options.spec.table.indexOf(name) !== -1
        }
    }

    protected override transformUpdateQuery(originalNode: UpdateQueryNode): UpdateQueryNode {
        const node = super.transformUpdateQuery(originalNode)
        const table = (() => {
            if (node.table.kind === "TableNode") {
                return node.table.table.identifier.name
            }
            else {
                if (node.table.node.kind === "TableNode") {
                    return node.table.node.table.identifier.name
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
        if (!this.includeTable(table)) {
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
        if (!this.includeTable(node.into.table.identifier.name)) {
            return node
        }
        if (node.values?.kind !== "ValuesNode") {
            if (this.options.throwOnUnsupported ?? false) {
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
