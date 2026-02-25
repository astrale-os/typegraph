# Bootstrap

Bootstrap provisions a kernel instance from a schema. It is idempotent: running it twice on the same schema is a no-op.

## What it does

1. Registers all node types and edge types defined in the schema
2. Registers all methods as operations
3. Sets up the permission model
4. Makes the kernel ready to accept operations

## API

```typescript
import { bootstrap } from '@astrale/builder'
import { Schema } from './schema'
import { methods } from './methods'

await bootstrap(Schema, {
  methods,
  adapter: 'in-memory',
})
```

### Config

```typescript
type BootstrapConfig<S extends Schema> = {
  methods: MethodsImpl<S>            // method implementations from defineMethods()
  adapter: 'in-memory' | 'falkor-local'   // which kernel adapter to use
  env?: 'dev' | 'prod'              // defaults to 'dev'
}
```

`methods` is required — bootstrap registers them as kernel operations. Omitting it is a type error.

## Guarantees

- **Idempotent** — safe to run on every deploy
- **Fails fast** — if the schema is incompatible with the current kernel state, bootstrap refuses and prints what needs a migration first
- **No data loss** — bootstrap never deletes nodes or edges; it only adds new types

## Relationship to diff/apply

Bootstrap only handles the *type registry*. It does not migrate existing data. If the schema has changed in a breaking way, run `diff` + `apply` before `bootstrap`.

```
schema changed
      │
   breaking?
   ├─ yes ──▶ diff + apply first, then bootstrap
   └─ no  ──▶ bootstrap (additive changes auto-applied)
```
