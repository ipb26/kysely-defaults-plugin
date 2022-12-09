# CallOrGet

A plugin that manipulates Kysely queries to add default values.

## Installation

```bash
npm install kysely-defaults-plugin
```

## Usage

```typescript

const companyId = 1
const userId = 1
const dateNow: RawNode = { kind: "RawNode", sqlFragments: ["UNIXEPOCH()"], parameters: [] }
const plugin = new KyselyDefaultsPlugin({
    specs: [
        {
            table: "*",
            columns: {
                companyId: [companyId],
                createdById: [userId],
                updatedById: [userId, userId],
                createdOn: [dateNow],
                updatedOn: [dateNow, dateNow],
                isDirty: {
                    update: true
                }
            }
        }
    ]
})

```

## License

[MIT](https://choosealicense.com/licenses/mit/)
