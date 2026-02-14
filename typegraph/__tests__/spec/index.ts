/**
 * Specification Test Suite Index
 *
 * This file exports all specification tests and provides documentation
 * on the test structure.
 *
 * ## Test Organization
 *
 * ```
 * __tests__/spec/
 * ├── fixtures/
 * │   └── test-schema.ts    # Shared test schema and helpers
 * ├── schema.spec.ts        # Schema builder specs (node, edge, defineSchema)
 * ├── ast.spec.ts           # AST builder specs (QueryAST operations)
 * ├── query-match.spec.ts   # Query compilation: MATCH and WHERE
 * ├── query-traversal.spec.ts # Query compilation: edge traversal
 * ├── query-projection.spec.ts # Query compilation: RETURN, ORDER BY, etc.
 * ├── query-hierarchy.spec.ts  # Query compilation: hierarchy operations
 * └── mutations.spec.ts     # Mutation operation specs
 * ```
 *
 * ## Running Tests
 *
 * ```bash
 * # Run all specification tests
 * pnpm test
 *
 * # Run specific spec file
 * pnpm test schema.spec
 *
 * # Run in watch mode
 * pnpm test:watch
 * ```
 *
 * ## Test Philosophy
 *
 * These are **specification tests** (also called "contract tests" or "golden tests").
 * They define the expected behavior at the API boundary before implementation.
 *
 * Key principles:
 * 1. Tests define the CONTRACT, not the implementation
 * 2. Tests should pass when implementation is complete
 * 3. Tests serve as living documentation
 * 4. Tests catch regressions during refactoring
 *
 * ## Coverage Summary
 *
 * ### Schema (schema.spec.ts)
 * - node() definition with properties, indexes, description
 * - edge() definition with cardinality, properties
 * - defineSchema() with hierarchy configuration
 *
 * ### AST (ast.spec.ts)
 * - Immutability guarantees
 * - Alias management (node and edge)
 * - Step generation for all operation types
 * - Projection configuration
 * - Validation
 *
 * ### Query Compilation
 *
 * #### Match (query-match.spec.ts)
 * - Basic node matching
 * - WHERE conditions (all operators)
 * - Complex WHERE (AND, OR, NOT)
 * - Edge existence filtering
 *
 * #### Traversal (query-traversal.spec.ts)
 * - to(), from(), via() traversal
 * - Optional traversal
 * - Edge property filtering
 * - Variable length paths
 * - Multi-edge traversal
 * - Edge alias capture
 *
 * #### Projection (query-projection.spec.ts)
 * - Basic RETURN
 * - Aliased returns (as, returning)
 * - COUNT and EXISTS
 * - DISTINCT
 * - ORDER BY
 * - LIMIT, SKIP, pagination
 * - Aggregation (GROUP BY, sum, avg, etc.)
 *
 * #### Hierarchy (query-hierarchy.spec.ts)
 * - parent() and children()
 * - ancestors() with depth options
 * - descendants() with depth options
 * - siblings()
 * - root()
 * - reachable() (transitive closure)
 *
 * ### Mutations (mutations.spec.ts)
 * - Node CRUD (create, update, delete)
 * - Edge CRUD (link, patchLink, unlink)
 * - Hierarchy operations (createChild, move, deleteSubtree, clone)
 * - Batch operations
 * - Transactions
 */

export * from './fixtures/test-schema'
