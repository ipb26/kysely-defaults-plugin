# Kysely Defaults Plugin

A plugin that manipulates Kysely queries to add default values.

## Installation

```bash
npm install kysely-defaults-plugin
```

## Usage

```typescript

const plugin = new KyselyDefaultsPlugin({
    throwOnUnsupported: true,
    tables: [
        {
            table: "*",
            columns: {
                column1: ["INSERT"]
            }
        },
        {
            table: "table1",
            columns: {
                column1: ["INSERT", "UPDATE"]
            }
        },
        {
            table: ["table1", "table2"],
            columns: {
                column1: {
                    always: node => "ALWAYS"
                }
            }
        },
        {
            table: [{ schema: "schema1", table: ["table1", "table2"] }]
            columns: {
                column1: {
                    insert: { kind: "RawNode", sqlFragments: ["UNIXEPOCH()"], parameters: [] },
                    update: { kind: "RawNode", sqlFragments: ["UNIXEPOCH()"], parameters: [] }
                }
            }
        },
        {
            table: (table, schema) => schema === "schema1" && ["table1", "table2"].includes(table),
            columns: {
                column1: {
                    always: "ALWAYS"
                }
            }
        },
    ]
})

```

## License

[MIT](https://choosealicense.com/licenses/mit/)
