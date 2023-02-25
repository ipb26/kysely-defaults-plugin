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
            defaults: {
                column1: ["INSERT"]
            }
        },
        {
            table: "table1",
            defaults: {
                column1: ["INSERT", "UPDATE"]
            }
        },
        {
            table: [{ schema: "schema1", table: ["table1", "table2"] }]
            overrides: {
                column1: {
                    insert: { kind: "RawNode", sqlFragments: ["UNIXEPOCH()"], parameters: [] },
                    update: { kind: "RawNode", sqlFragments: ["UNIXEPOCH()"], parameters: [] }
                }
            }
        },
        {
            table: (table, schema) => schema === "schema1" && ["table1", "table2"].includes(table),
            overrides: {
                column1: {
                    insert: "INSERT",
                    update: "UPDATE"
                }
            }
        }
    ]
})

```

## License

[MIT](https://choosealicense.com/licenses/mit/)
