
export type TableIndividualMatch = string | "*" | ((name: string) => boolean)
export type TableMatch = string | "*" | { table: TableIndividualMatch | TableIndividualMatch[], schema: TableIndividualMatch | TableIndividualMatch[] } | ((table: string, schema?: string) => boolean)

export class TableMatcher {

    constructor(private readonly matchers: TableMatch | TableMatch[]) {
    }

    private match(matcher: TableMatch, table: string, schema: string | undefined) {
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
        return matcher === "*" || matcher === name
    }

    test(table: string, schema: string | undefined) {
        return [this.matchers].flat().map(_ => this.match(_, table, schema)).includes(true)
    }

}
