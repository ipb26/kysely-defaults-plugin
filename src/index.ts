import { ColumnNode, ColumnUpdateNode, InsertQueryNode, KyselyPlugin, ListNodeItem, OperationNodeTransformer, PluginTransformQueryArgs, PluginTransformResultArgs, UpdateQueryNode, ValueExpressionNode, ValueNode, ValuesItemNode } from "kysely"
import { SchemableIdentifierNode } from "kysely/dist/cjs/operation-node/schemable-identifier-node"
import { callOrGet, ValueOrFactory } from "value-or-factory"

export type DefaultTable = { table: DefaultMatchers, columns: Record<string, DefaultColumn> }
export type DefaultStringMatcher = string | "*"
export type DefaultStringOrFunctionMatcher = string | "*" | ((name: string) => boolean)
export type DefaultMatcher = DefaultStringMatcher | { table: DefaultStringOrFunctionMatcher | DefaultStringOrFunctionMatcher[], schema: DefaultStringOrFunctionMatcher } | ((table: string, schema?: string) => boolean)
export type DefaultMatchers = DefaultMatcher | DefaultMatcher[]
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

    constructor(private readonly options: DefaultsTransformerOptions) {
        super()
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
    private matchString(name: string, matcher: DefaultStringMatcher) {
        if (matcher === "*") {
            return true
        }
        return matcher === name
    }
    private matchStringOrFunction(name: string, matcher: DefaultStringOrFunctionMatcher) {
        if (typeof matcher === "function") {
            return matcher(name)
        }
        return this.matchString(name, matcher)
    }
    private testMatcher(node: SchemableIdentifierNode, matcher: DefaultMatcher) {
        const tableName = node.identifier.name
        const schemaName = node.schema?.name
        if (typeof matcher === "function") {
            return matcher(tableName, schemaName)
        }
        else if (typeof matcher === "object") {
            if (schemaName === undefined) {
                return false
            }
            const tableMatcher = Array.isArray(matcher.table) ? matcher.table : [matcher.table]
            const schemaMatcher = matcher.schema
            const tableMatches = tableMatcher.map(_ => this.matchStringOrFunction(tableName, _)).includes(true)
            const schemaMatches = this.matchStringOrFunction(schemaName, schemaMatcher)
            return tableMatches && schemaMatches
        }
        else {
            return this.matchString(tableName, matcher)
        }
    }
    private includeTable(node: SchemableIdentifierNode) {
        const matcher = this.options.table.table
        if (Array.isArray(matcher)) {
            return matcher.map(_ => this.testMatcher(node, _)).includes(true)
        }
        return this.testMatcher(node, matcher)
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
        if (!this.includeTable(node.into.table)) {
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
