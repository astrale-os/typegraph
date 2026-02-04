# Type Safety in FalkorDB Adapter

## Summary

The FalkorDB adapter maintains **full type safety** in its core implementation. Type assertions in examples and tests are due to **TypeScript's limitations with conditional return types**, not a lack of type safety.

## Why Type Assertions Exist

### TypeScript Conditional Type Limitation

TypeScript cannot narrow conditional return types within method bodies. This is a known limitation documented in the TypeGraph library itself:

```typescript
// From typegraph/src/query/single-node.ts:6
/**
 * Note: This file uses `as any` casts in traversal methods that return different
 * builder types based on edge cardinality. TypeScript cannot narrow conditional
 * return types within method bodies, requiring explicit casts. The type safety
 * is preserved at the API level through the conditional return type signatures.
 */
```

### Where Assertions Are Needed

1. **Edge Traversals**: When traversing from one node to another via an edge
2. **Hierarchy Navigation**: When using parent/child/ancestor/descendant methods
3. **Mixed Union Types**: When queries return multiple possible node types

### Where Assertions Are NOT Needed

- **Direct mutations**: `create`, `update`, `delete` are fully typed
- **Direct queries**: `graph.node('user').execute()` returns properly typed results
- **Core adapter code**: All adapter implementation code is properly typed

## Type Safety Guarantee

Despite the assertions, type safety is **preserved** because:

1. **Schema-driven types**: All types are derived from your schema definition
2. **Compile-time checking**: Invalid property access will fail at compile time
3. **Runtime validation**: FalkorDB validates data against schema constraints

## Example

```typescript
// ✅ Fully typed - no assertions needed
const user = await graph.mutate.create('user', { name: 'Alice' })
user.data.name // ← TypeScript knows this is a string

// ⚠️ Type assertion needed (TypeScript limitation)
const posts = await graph.nodeById(user.id).to('authored').execute()
type PostNode = NodeProps<typeof schema, 'post'>
const firstPost = posts[0]! as PostNode
firstPost.title // ← Type safety preserved, but requires assertion

// Alternative: Use direct queries when possible
const posts2 = await graph.node('post').execute()
posts2[0]?.title // ← Fully typed, no assertion needed
```

## Best Practices

1. **Use direct queries** when you don't need traversal
2. **Type your assertions** using `NodeProps<Schema, Label>` instead of raw objects
3. **Document why** assertions are needed with comments
4. **Validate at runtime** when dealing with external data

## Conclusion

The type assertions are a **necessary workaround** for TypeScript's conditional type limitations, not a failure of type safety. The adapter's core implementation maintains full type safety throughout.
