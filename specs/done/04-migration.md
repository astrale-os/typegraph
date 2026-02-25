# Spec 04: Migration System

> Schema diffing, migration planning, and data transformation.
> Package: `@astrale/typegraph-client` (migration component)

**Status: stub — needs full design.**

---

## Scope

When a KRL schema changes between versions, the graph database may need structural updates. The migration system handles the full lifecycle:

1. **Diff** — compare previous `SchemaIR` to current `SchemaIR`, produce a typed `SchemaDiff`
2. **Plan** — from the diff, generate a `MigrationPlan` (ordered list of operations)
3. **Execute** — apply the plan against the database (with rollback support)
4. **Validate** — verify post-migration integrity

---

## What Triggers Migration

`createGraph()` detects schema mismatch → throws `SchemaMismatchError(diff)`.
The developer then runs the migration tool explicitly — migrations are never auto-applied.

---

## Change Categories

| Change | Category | Migratable? | Notes |
|--------|----------|-------------|-------|
| New node/edge type | Addition | Auto | Create meta-node, no data impact |
| New attribute (with default) | Addition | Auto | Backfill existing nodes |
| New attribute (no default, non-nullable) | Breaking | Manual | Needs backfill strategy |
| New method on existing type | Addition | Auto | No data impact (methods are runtime) |
| Removed type | Breaking | Manual | Data deletion or archival |
| Removed attribute | Breaking | Manual | Data loss |
| Renamed type | Breaking | Manual | Needs rename mapping |
| Changed attribute type | Breaking | Manual | Needs transform function |
| Removed method | Breaking | Auto | No data impact |
| New constraint on existing edge | Tightening | Conditional | Validate existing data first |
| Relaxed constraint | Loosening | Auto | No validation needed |

---

## Design Questions

- **Storage of previous schema**: where is the "previous" `SchemaIR` persisted? In the database as a meta-node? On filesystem?
- **Migration file format**: code-based (TypeScript functions) or declarative (JSON plan)?
- **Backfill**: how to express data transforms for type changes? Lambda per attribute?
- **Dry-run**: preview migration plan without executing
- **Rollback**: transactional rollback on failure? Snapshot-based?
- **CLI integration**: `astrale migrate`, `astrale migrate:plan`, `astrale migrate:status`
- **Multi-step migrations**: chaining multiple schema versions (v1 → v2 → v3)
- **Concurrent access**: lock strategy during migration

---

## Relationship to Other Specs

- [02-schema-runtime.md](./02-schema-runtime.md) §2 — `installSchema` detects mismatch, delegates to migration
- [03-krl-methods.md](./03-krl-methods.md) — method additions/removals are part of the diff
- Kernel compiler — produces the `SchemaIR` that feeds both sides of the diff
