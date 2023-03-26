import { AliasNode, OperationNode, TableNode } from "kysely"

export type TableIndividualMatch = string | ((name: string) => boolean) | RegExp
export type TableMatch = string | { table: TableIndividualMatch | TableIndividualMatch[], schema: TableIndividualMatch | TableIndividualMatch[] } | ((table: string, schema?: string) => boolean)

export class TableMatcher {

    constructor(private readonly matchers: TableMatch | TableMatch[]) {
    }

    private match(matcher: TableMatch, node: TableNode) {
        const table = node.table.identifier.name
        const schema = node.table.schema?.name
        if (typeof matcher === "function") {
            return matcher(table, schema)
        }
        else if (typeof matcher === "object") {
            if (schema === undefined) {
                return false
            }
            return [matcher.table].flat().map(_ => this.individualMatch(_, table)).includes(true) && [matcher.schema].flat().map(_ => this.individualMatch(_, schema)).includes(true)
        }
        else {
            const [first, second] = matcher.split(".")
            if (second === undefined) {
                return first === "*" || first === table
            }
            else {
                return (first === "*" || first === schema) && (second === "*" || second === table)
            }
        }
    }
    private individualMatch(matcher: TableIndividualMatch, name: string) {
        if (typeof matcher === "function") {
            return matcher(name)
        }
        if (typeof matcher === "object") {
            return matcher.test(name)
        }
        return matcher === "*" || matcher === name
    }

    table(node: OperationNode) {
        if (TableNode.is(node)) {
            return node
        }
        else if (AliasNode.is(node) && TableNode.is(node.node)) {
            return node.node
        }
    }

    test(node: TableNode) {
        return [this.matchers].flat().map(_ => this.match(_, node)).includes(true)
    }

}
