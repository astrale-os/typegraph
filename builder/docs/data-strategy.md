# Data Strategy

Three layers of initial data, each with a distinct purpose, lifecycle, and ref scope.

## Overview

```
┌─────────────────────────────────────────────────────────┐
│  kernel data       automatic, schema-agnostic           │
│  (bootstrap script)  __SYSTEM__, root node              │
│                      → kernelRefs                       │
├─────────────────────────────────────────────────────────┤
│  core data         developer-defined, deployed to prod  │
│  (core.ts)           initial instances the app needs    │
│                      → coreRefs                         │
├─────────────────────────────────────────────────────────┤
│  seed data         developer-defined, dev only          │
│  (seed.ts)           test and dev fixtures              │
│                      → seedRefs                         │
└─────────────────────────────────────────────────────────┘
```

Each layer can reference layers above it. Never the reverse.

---

## Terminology note — "data" in two contexts

In this document, **core data** and **seed data** mean initial graph records created by `defineCore()` / `defineSeed()` (nodes and links in the kernel graph).

This is different from schema-level `node.data` / `iface.data` in `schema.ts`, which describes datastore-backed structured content resolved through typed method returns (for example `method({ returns: data() })` + `ctx.data()` in method impl).

Think of it as:
- **Core/Seed data** → *when* graph records are created (deployment lifecycle)
- **`node.data`** → *where* a node's rich content is stored (datastore vs graph props)

---

## Layer 1 — Kernel data

Created by the bootstrap script when the kernel starts. No developer input.

Contains:
- `__SYSTEM__` identity node
- Root node (parent of all nodes in the graph)
- Initial system permissions

Exposed as `kernelRefs`, imported from `@astrale/builder` and used in links:

```typescript
import { kernelRefs } from '@astrale/builder'
kernelRefs.root
kernelRefs.system
```

These refs are always available at apply time — the kernel bootstrap has already run.

---

## Layer 2 — Core data

Mandatory initial state for the distribution. Deployed to production. Defined by the developer.

```typescript
// core.ts
import { defineCore, create, link, kernelRefs } from '@astrale/builder'
import { Schema } from './schema'

const workspace = create(Workspace, { name: 'default' })
const adminRole = create(Role, { name: 'admin' })

export const core = defineCore(Schema, 'myapp', {
  nodes: { workspace, adminRole },
  links: [
    link(workspace, 'hasParent', kernelRefs.root),
    link(kernelRefs.system, 'hasPerm', workspace, { perm: 'admin' }),
  ],
})
```

### Apply

```typescript
import { applyCore } from '@astrale/builder'
import { core } from './core'

const coreRefs = await applyCore(core)
// coreRefs.workspace  → resolved node
// coreRefs.adminRole  → resolved node
```

### Guarantees

- **Idempotent** — MERGE semantics, re-running is a no-op
- **Typed** — `core.refs` is typed from `nodes` keys
- **Persistent** — refs are stored in the graph by key, resolvable at runtime

---

## Layer 3 — Seed data

Optional fixtures for development and testing. Never deployed to production.

Declares an explicit dependency on `core` — refs are reused via `core.refs`.

```typescript
// seed.ts
import { defineSeed, create, link } from '@astrale/builder'
import { Schema } from './schema'
import { core } from './core'

const alice = create(User, { email: 'alice@test.com', name: 'Alice' })

export const seed = defineSeed(Schema, core, {
  nodes: { alice },
  links: [link(alice, 'belongsTo', core.refs.workspace)],
})
```

### Apply

```typescript
import { applySeed } from '@astrale/builder'
import { seed } from './seed'

await applySeed(seed)
// applies core first if needed, then seed
```

---

## Runtime ref resolution

Refs are persisted in the graph at apply time (MERGE on key). They can be resolved at any point on a live kernel — no need to re-run bootstrap:

```typescript
import { db } from './sdk'
import { core } from './core'

// Resolves 'myapp:workspace' in the graph → returns the node
const workspace = await db.ref(core.refs.workspace)
```

---

## Ref namespacing

`defineCore()` takes a namespace string (second argument). Ref keys are stored as `namespace:refName` to avoid collisions across distributions.

```typescript
defineCore(Schema, 'ecommerce', ...)    // stores 'ecommerce:workspace'
defineCore(Schema, 'auth', ...)         // stores 'auth:adminRole'
```

`defineSeed()` inherits the namespace from the `core` it depends on — no separate namespace argument, and links can target `core.refs.*`.

---

## Ref flow summary

```
kernelRefs  { root, system }
    │  used in links
    ▼
defineCore(Schema, ns, {
    nodes: { workspace, adminRole },
    links: [link(workspace, 'hasParent', kernelRefs.root), ...]
})
    │  produces
    ▼
core.refs  { workspace, adminRole }
    │  reused in links
    ▼
defineSeed(Schema, core, {
    nodes: { alice },
    links: [link(alice, 'belongsTo', core.refs.workspace)]
})
    │  produces
    ▼
seedRefs  { alice }
```

---

## What goes where

| Data | Layer | File | Deployed |
|---|---|---|---|
| `__SYSTEM__`, root node | kernel | bootstrap script | always |
| Default workspace, roles, policies | core | `core.ts` | prod + dev |
| Test users, fixtures, sample content | seed | `seed.ts` | dev only |
