import { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, QueryResult, RootOperationNode, UnknownRow } from "kysely"

export interface RestrictionPluginOptions {

    readonly allowed?: RootOperationNode["kind"][] | undefined
    readonly disallowed?: RootOperationNode["kind"][] | undefined

}

export class RestrictionPlugin implements KyselyPlugin {

    constructor(private readonly options: RestrictionPluginOptions) {
    }

    transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
        if (this.options.allowed !== undefined) {
            if (!this.options.allowed.includes(args.node.kind)) {
                throw new Error("Operation not allowed: " + args.node.kind + ".")
            }
        }
        if (this.options.disallowed !== undefined) {
            if (this.options.disallowed.includes(args.node.kind)) {
                throw new Error("Operation not allowed: " + args.node.kind + ".")
            }
        }
        return args.node
    }
    async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
        return args.result
    }

}
