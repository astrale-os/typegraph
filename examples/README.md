# Examples

End-to-end walkthroughs of the typegraph pipeline: **GSL → IR → Generated TypeScript → Core → Methods → SDK**.

## Structure

Each directory follows the same layout:

| File | Source | Description |
|------|--------|-------------|
| `schema.gsl` | hand-written | GSL schema definition |
| `schema.ir.json` | generated | Compiler output (SchemaIR) |
| `schema.generated.ts` | generated | Codegen output (types, validators, schema, core DSL, methods) |
| `core.ts` | hand-written | `defineCore()` — genesis data |
| `methods.ts` | hand-written | `MethodsConfig` — method implementations |
| `usage.ts` | hand-written | `createGraph()` — queries, traversals, mutations |

## Examples

| Directory | Features |
|-----------|----------|
| **e-commerce/** | Interfaces, inheritance, type aliases, edge constraints, cardinality, edge attributes, node + edge methods |
| **social/** | Self-referencing edges (`follows`), `no_self`/`unique` constraints, reverse traversals |
| **kernel/** | Extending the kernel prelude, `Identity`, permission edges, multi-hop traversals |

## Regenerating

```bash
# Single example
npx tsx examples/generate.ts examples/e-commerce

# All examples
npx tsx examples/generate.ts --all

# Verify generated files are up-to-date (CI)
npx tsx examples/generate.ts --check
```

The `schema.ir.json` and `schema.generated.ts` files are committed for reading convenience. The `--check` flag exits non-zero if they're stale.
