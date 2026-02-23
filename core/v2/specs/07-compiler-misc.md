# Sub-Spec 07: Cypher Compiler - Unwind & Except

**File:** `packages/typegraph/src/compiler/cypher/compiler.ts`
**Dependencies:** Sub-Specs 01-02 (AST Types and Builder)
**Estimated Duration:** 0.5 days

---

## Overview

This sub-spec covers compilation of UnwindStep and the 'except' operator for BranchStep.

---

## Tasks

### Task 7.1: Implement compileUnwind()

**Purpose:** Compile UnwindStep to UNWIND clause.

```typescript
// Location: compiler.ts

/**
 * Compile an unwind step to UNWIND clause.
 *
 * @example
 * // Input: { sourceAlias: 'post', field: 'tags', itemAlias: 'tag' }
 * // Output: UNWIND post.tags AS tag
 */
private compileUnwind(step: UnwindStep): void {
  const source = `${step.sourceAlias}.${step.field}`
  this.clauses.push(`UNWIND ${source} AS ${step.itemAlias}`)
}
```

**Acceptance Criteria:**
- [ ] Compiles to correct UNWIND syntax
- [ ] Source alias and field combined correctly
- [ ] Item alias used after AS

---

### Task 7.2: Add Unwind Case to compile()

**Purpose:** Integrate UnwindStep into the main compilation loop.

```typescript
// In compileStep() switch

case 'unwind':
  this.compileUnwind(step as UnwindStep)
  break
```

**Acceptance Criteria:**
- [ ] UnwindStep handled in compilation
- [ ] No runtime errors

---

### Task 7.3: Handle Empty Array Unwind

**Purpose:** Document and optionally handle UNWIND of empty arrays.

```cypher
-- Cypher behavior: UNWIND of empty array produces no rows
-- This is usually desired, but sometimes you want to preserve the row

-- To preserve rows with empty arrays, use COALESCE:
UNWIND COALESCE(post.tags, [null]) AS tag
```

```typescript
/**
 * Compile unwind with optional null preservation.
 */
private compileUnwind(step: UnwindStep): void {
  const source = `${step.sourceAlias}.${step.field}`

  if (step.preserveEmpty) {
    // Preserve row even if array is empty or null
    this.clauses.push(`UNWIND COALESCE(${source}, [null]) AS ${step.itemAlias}`)
  } else {
    this.clauses.push(`UNWIND ${source} AS ${step.itemAlias}`)
  }
}
```

**Note:** Add `preserveEmpty?: boolean` to UnwindStep type in Sub-Spec 01 if this feature is desired.

**Acceptance Criteria:**
- [ ] Basic unwind works
- [ ] Optional: preserveEmpty flag supported

---

### Task 7.4: Implement 'except' Operator in compileBranch()

**Purpose:** Add set difference (EXCEPT) support to BranchStep.

```typescript
// Location: In compileBranch() method

/**
 * Compile branch step with union, intersect, or except.
 */
private compileBranch(step: BranchStep): void {
  const compiledBranches = step.branches.map(branch => {
    const subCompiler = this.createSubCompiler()
    return subCompiler.compileSteps(branch)
  })

  // Determine the set operator
  let operator: string
  switch (step.operator) {
    case 'union':
      operator = step.distinct ? 'UNION' : 'UNION ALL'
      break
    case 'intersect':
      // Note: Not all Cypher implementations support INTERSECT
      // For compatibility, can be rewritten as exists subquery
      operator = 'INTERSECT'
      break
    case 'except':
      // Note: Not all Cypher implementations support EXCEPT
      // For compatibility, can be rewritten as NOT EXISTS
      operator = 'EXCEPT'
      break
    default:
      throw new Error(`Unknown branch operator: ${step.operator}`)
  }

  // Combine branches
  const cypherParts: string[] = []
  for (let i = 0; i < compiledBranches.length; i++) {
    const branchCypher = compiledBranches[i].clauses.join('\n')
    cypherParts.push(branchCypher)

    // Merge parameters
    Object.assign(this.params, compiledBranches[i].params)
  }

  // Join with operator
  // Note: In Cypher, each branch needs its own complete query
  const combined = cypherParts.join(`\n${operator}\n`)
  this.clauses.push(combined)
}
```

**Acceptance Criteria:**
- [ ] 'except' operator produces EXCEPT keyword
- [ ] Branches compiled and combined correctly
- [ ] Parameters merged from all branches

---

### Task 7.5: Handle Database Compatibility for EXCEPT

**Purpose:** Some databases don't support EXCEPT natively.

```typescript
/**
 * Compile EXCEPT using NOT EXISTS for compatibility.
 *
 * A EXCEPT B is equivalent to:
 * A WHERE NOT EXISTS { B WHERE A.id = B.id }
 */
private compileBranchExceptCompat(step: BranchStep): void {
  if (step.branches.length !== 2) {
    throw new Error('EXCEPT requires exactly 2 branches')
  }

  const [firstBranch, secondBranch] = step.branches

  // Compile first branch as main query
  const mainCompiler = this.createSubCompiler()
  const mainResult = mainCompiler.compileSteps(firstBranch)

  // Compile second branch as NOT EXISTS condition
  const subCompiler = this.createSubCompiler()
  const subResult = subCompiler.compileSteps(secondBranch)

  // Build the compatible query
  // This is a simplification - actual implementation depends on
  // what the branches return and how to correlate them

  this.clauses.push(...mainResult.clauses)
  this.clauses.push(`WHERE NOT EXISTS {`)
  for (const clause of subResult.clauses) {
    this.clauses.push(`  ${clause}`)
  }
  // Add correlation condition based on return aliases
  // This requires knowledge of what both branches return
  this.clauses.push(`}`)

  Object.assign(this.params, mainResult.params, subResult.params)
}
```

**Note:** Full compatibility mode implementation may be complex and database-specific. Consider making this a compiler option.

**Acceptance Criteria:**
- [ ] Option to use native EXCEPT or compatibility mode
- [ ] Documentation of database support

---

### Task 7.6: Add DISTINCT Support for EXCEPT

**Purpose:** Handle distinct flag with EXCEPT.

```typescript
// In compileBranch()

case 'except':
  // EXCEPT implicitly removes duplicates in standard SQL
  // EXCEPT ALL preserves duplicates but isn't widely supported
  operator = step.distinct ? 'EXCEPT' : 'EXCEPT ALL'
  break
```

**Note:** EXCEPT ALL is not supported by all databases. Document limitations.

**Acceptance Criteria:**
- [ ] distinct: true → EXCEPT
- [ ] distinct: false → EXCEPT ALL (with compatibility note)

---

## Testing

### Unit Tests

```typescript
// test/compiler/misc.test.ts

import { CypherCompiler, QueryAST } from '@astrale/typegraph-client'

describe('Unwind Compilation', () => {
  let compiler: CypherCompiler

  beforeEach(() => {
    compiler = new CypherCompiler(schema)
  })

  it('compiles basic unwind', () => {
    const ast = new QueryAST()
      .addMatch({ labels: ['Post'], alias: 'post' })
      .addUnwind({
        sourceAlias: 'post',
        field: 'tags',
        itemAlias: 'tag',
      })

    const result = compiler.compile(ast)
    expect(result.cypher).toContain('UNWIND post.tags AS tag')
  })

  it('unwind followed by where', () => {
    const ast = new QueryAST()
      .addMatch({ labels: ['Post'], alias: 'post' })
      .addUnwind({
        sourceAlias: 'post',
        field: 'tags',
        itemAlias: 'tag',
      })
      .addWhere([{
        type: 'comparison',
        field: null, // tag is a value, not a node
        operator: 'eq',
        value: 'typescript',
        target: 'tag',
      }])

    const result = compiler.compile(ast)
    expect(result.cypher).toContain('UNWIND post.tags AS tag')
    expect(result.cypher).toContain('WHERE')
  })
})

describe('Except Operator Compilation', () => {
  let compiler: CypherCompiler

  beforeEach(() => {
    compiler = new CypherCompiler(schema)
  })

  it('compiles EXCEPT branch', () => {
    const ast = new QueryAST().addBranch({
      operator: 'except',
      branches: [
        [{ type: 'match', labels: ['User'], alias: 'u1' }],
        [{ type: 'match', labels: ['Admin'], alias: 'u2' }],
      ],
      distinct: true,
    })

    const result = compiler.compile(ast)
    expect(result.cypher).toContain('EXCEPT')
  })

  it('compiles EXCEPT ALL when distinct is false', () => {
    const ast = new QueryAST().addBranch({
      operator: 'except',
      branches: [
        [{ type: 'match', labels: ['User'], alias: 'u' }],
        [{ type: 'match', labels: ['Premium'], alias: 'p' }],
      ],
      distinct: false,
    })

    const result = compiler.compile(ast)
    expect(result.cypher).toContain('EXCEPT ALL')
  })
})
```

### Integration Tests

```typescript
// test/integration/unwind.integration.test.ts

describe('Unwind Integration', () => {
  it('unwinds array field and filters', async () => {
    await graph.mutate.create('Post', {
      id: 'p1',
      title: 'TypeScript Tips',
      tags: ['typescript', 'javascript', 'programming'],
    })

    const results = await graph
      .node('Post')
      .unwind('tags', 'tag')
      .where('tag', 'eq', 'typescript')
      .execute()

    expect(results).toHaveLength(1)
  })

  it('unwinds and aggregates', async () => {
    await graph.mutate.create('Post', { id: 'p1', tags: ['a', 'b', 'c'] })
    await graph.mutate.create('Post', { id: 'p2', tags: ['a', 'b'] })
    await graph.mutate.create('Post', { id: 'p3', tags: ['a'] })

    const results = await graph
      .node('Post')
      .unwind('tags', 'tag')
      .return({
        expression: { type: 'field', alias: 'tag', field: null },
        as: 'tagName',
      })
      .groupBy('tagName')
      .count('postCount')
      .execute()

    // 'a' should have count 3
    const tagA = results.find(r => r.tagName === 'a')
    expect(tagA.postCount).toBe(3)
  })
})
```

---

## Checklist

- [ ] Task 7.1: compileUnwind() method
- [ ] Task 7.2: Add unwind case to compile()
- [ ] Task 7.3: Handle empty array unwind (optional)
- [ ] Task 7.4: Implement 'except' in compileBranch()
- [ ] Task 7.5: Database compatibility for EXCEPT (optional)
- [ ] Task 7.6: DISTINCT support for EXCEPT
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] All tests passing

---

*Sub-spec version: 1.0*
