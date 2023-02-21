import { InsertQueryNode, KyselyPlugin, ListNodeItem, OperationNodeTransformer, PluginTransformQueryArgs, PluginTransformResultArgs, UpdateQueryNode, ValueExpressionNode, ValuesItemNode } from "kysely"
import { callOrGet, ValueOrFactory } from "value-or-factory"
import { TableMatch, TableMatcher } from "./matcher"

export type DefaultColumns = Record<string, DefaultColumn>
export type DefaultTable = { table: TableMatch | TableMatch[], defaults?: DefaultColumns, overrides?: DefaultColumns }
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

export class DefaultsPlugin implements KyselyPlugin {

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

export type DefaultsTransformerOptions = {
    table: DefaultTable
    throwOnUnsupported?: boolean
}

export class DefaultsTransformer extends OperationNodeTransformer {

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
    private insertValues(node: InsertQueryNode, columns?: DefaultColumns) {
        return Object.fromEntries(Object.entries(columns ?? {}).flatMap(([key, config]) => {
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
        }))
    }
    private updateValues(node: InsertQueryNode | UpdateQueryNode, columns?: DefaultColumns) {
        return Object.fromEntries(Object.entries(columns ?? {}).flatMap(([key, config]) => {
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
        }))
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
        const defaults = this.updateValues(node, this.options.table.defaults)
        const overrides = this.updateValues(node, this.options.table.overrides)
        const updates = {
            ...defaults,
            ...Object.fromEntries((node.updates ?? []).map(_ => [_.column.column.name, _.value])),
            ...overrides,
        }
        return {
            ...node,
            updates: Object.entries(updates).map(update => {
                return {
                    kind: "ColumnUpdateNode",
                    column: {
                        kind: "ColumnNode",
                        column: {
                            kind: "IdentifierNode",
                            name: update[0],
                        }
                    },
                    value: update[1]
                }
            })
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
        const insertDefaults = this.insertValues(node, this.options.table.defaults)
        const insertOverrides = this.insertValues(node, this.options.table.overrides)
        const updateDefaults = this.updateValues(node, this.options.table.defaults)
        const updateOverrides = this.updateValues(node, this.options.table.overrides)
        const originalColumnNames = node.columns?.map(_ => _.column.name) ?? []
        const columnNames = [...Object.keys(insertDefaults), ...originalColumnNames, ...Object.keys(insertOverrides)].filter((value, index, array) => array.indexOf(value) === index)
        return {
            ...node,
            onConflict: (() => {
                if (node.onConflict === undefined) {
                    return
                }
                const updates = {
                    ...updateDefaults,
                    ...Object.fromEntries((node.onConflict.updates ?? []).map(_ => [_.column.column.name, _.value])),
                    ...updateOverrides,
                }
                return {
                    ...node.onConflict,
                    updates: Object.entries(updates).map(update => {
                        return {
                            kind: "ColumnUpdateNode",
                            column: {
                                kind: "ColumnNode",
                                column: {
                                    kind: "IdentifierNode",
                                    name: update[0],
                                }
                            },
                            value: update[1],
                        }
                    })
                }
            })(),
            columns: columnNames.map(name => {
                return {
                    kind: "ColumnNode" as const,
                    column: {
                        kind: "IdentifierNode" as const,
                        name,
                    }
                }
            }),
            values: {
                kind: "ValuesNode",
                values: [
                    ...node.values.values.map<ValuesItemNode>(list => {
                        return {
                            kind: "ValueListNode",
                            values: (() => {
                                const original = list.kind === "ValueListNode" ? list.values : list.values.map(value => ({ kind: "ValueNode" as const, value }))
                                const values = {
                                    ...insertDefaults,
                                    ...Object.fromEntries((originalColumnNames).map((name, index) => [name, original[index]])),
                                    ...insertOverrides,
                                }
                                return columnNames.map(name => values[name]!)
                            })()
                        }
                    })
                ]
            }
        }
    }

}
