# Diff & Apply

Diff compares the current schema against the running kernel and produces a migration plan. Apply executes it.

## Diff

```typescript
import { diff } from '@astrale/builder'
import { Schema } from './schema'

const plan = await diff(Schema)
```

### Plan output

```
[+] node    Product
[+] edge    inCategory (Product → Category)
[~] node    Customer   added prop: phone (optional)
[-] node    LegacyItem  ← BREAKING: has 42 instances
```

Changes are classified:

| Symbol | Meaning |
|---|---|
| `[+]` | additive — safe, no action needed |
| `[~]` | modification — requires migration strategy |
| `[-]` | removal — breaking if data exists |

## Apply

```typescript
import { apply } from '@astrale/builder'
import { plan } from './plan'

await apply(plan)
```

### Migration strategies

For `[~]` and `[-]` changes, you must declare a strategy:

```typescript
import { diff, strategy } from '@astrale/builder'
import { Schema } from './schema'

const plan = await diff(Schema, {
  migrations: {
    'Customer.phone':  strategy.default(null),          // fill missing values with null
    'LegacyItem':      strategy.deleteAll(),            // delete all instances
    'Order.status':    strategy.transform(              // custom per-node transform
      (node) => ({ ...node, status: 'pending' })
    ),
  }
})
```

## Additive changes (auto-applied)

These never require a strategy and are applied automatically during `bootstrap` or `apply`:

- New node type
- New edge type
- New optional property on existing type
- New method
- New interface

## Breaking changes (require strategy)

- Removing a node or edge type that has instances
- Removing a required property
- Changing a property type
- Making an optional property required

## Dry run

```typescript
const plan = await diff(Schema)
plan.print()   // show what would happen, no writes
```
