# Builder

Builder is the developer-facing layer that turns a TypeScript schema into a running kernel, typed data, and a graph SDK.

## What you author

Your schema file plus the kernel shipped by the package:

```
@astrale/builder/kernel ──┐
app.schema.ts             ──┴─ defineSchema() ──▶ Schema
```

The schema is the single source of truth for:
- the shape of the graph (nodes, edges, interfaces, methods)
- datastore-backed node content schemas (`node.data` / `iface.data`)
- the permissions model

## What you get

| Capability | Description |
|---|---|
| **Bootstrap** | provision a kernel from the schema |
| **Seed** | populate initial graph data |
| **Diff** | detect schema drift and plan changes |
| **Apply** | migrate the kernel to a new schema version |
| **SDK** | a typed client to query and mutate the graph |

## Workflow

```
define schema
      │
      ▼
  bootstrap ──▶ kernel running
      │
      ▼
  seed ──▶ initial data in graph
      │
      ▼
  (schema changes)
      │
      ▼
  diff ──▶ review changes
      │
      ▼
  apply ──▶ kernel updated
```

The SDK is derived from the schema and is always in sync with the current schema version. No codegen.

## Documentation

| Doc | Purpose |
|---|---|
| [SCHEMA_API.md](SCHEMA_API.md) | API reference — builders, types, examples |
| [PLAN.md](PLAN.md) | Implementation plan and task list |
| **Feature docs** | |
| [docs/bootstrap.md](docs/bootstrap.md) | Bootstrap spec |
| [docs/data-strategy.md](docs/data-strategy.md) | Core/Seed graph records + terminology with `node.data` |
| [docs/diff.md](docs/diff.md) | Diff & Apply migration |
| [docs/sdk.md](docs/sdk.md) | Typed graph client |
| [docs/developer-flow.md](docs/developer-flow.md) | End-to-end developer guide |
| **Design decisions** | |
| [docs/design/typing-strategy.md](docs/design/typing-strategy.md) | Typing strategy (config types, inference, error readability) |
| [docs/design/schema-as-source.md](docs/design/schema-as-source.md) | Why no codegen for the TS client |
| [docs/design/schema-assembly.md](docs/design/schema-assembly.md) | Flat export + auto-categorisation |

## What is NOT covered here

- Internal IR format
- Compiler passes
- Transport / protocol details
- Adapter internals (in-memory, WorkOS, etc.)
