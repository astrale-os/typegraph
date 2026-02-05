# Sub-Spec 03: Visitor Pattern Updates

**File:** `packages/core/src/ast/visitor.ts`
**Dependencies:** Sub-Spec 01 (AST Type Definitions)
**Estimated Duration:** 0.5 days

---

## Overview

This sub-spec covers updates to the visitor pattern to support all new AST node types and fix missing visitor methods for existing types.

---

## Tasks

### Task 3.1: Add Missing Visitor Methods

**Purpose:** Fix existing gaps in the visitor interface.

```typescript
// Location: visitor.ts, add to ASTVisitorInterface

export interface ASTVisitorInterface<TResult, TContext = void> {
  // ... existing methods ...

  // Previously missing methods
  visitMatchById?(node: MatchByIdStep, context: TContext): TResult
  visitFork?(node: ForkStep, context: TContext): TResult
}
```

**Update visit() switch:**

```typescript
visit(node: ASTNode, context: TContext): TResult | undefined {
  switch (node.type) {
    // ... existing cases ...

    case 'matchById':
      return this.visitMatchById?.(node, context)
    case 'fork':
      return this.visitFork?.(node, context)
  }
}
```

**Acceptance Criteria:**
- [ ] `visitMatchById` added to interface
- [ ] `visitFork` added to interface
- [ ] Both cases added to `visit()` switch

---

### Task 3.2: Add PatternStep Visitor

**Purpose:** Support visiting PatternStep nodes.

```typescript
// Add to ASTVisitorInterface
visitPattern?(node: PatternStep, context: TContext): TResult

// Add to visit() switch
case 'pattern':
  return this.visitPattern?.(node, context)
```

**Add to base visitor class:**

```typescript
export abstract class ASTVisitor<TResult, TContext = void>
  implements ASTVisitorInterface<TResult, TContext>
{
  // ... existing methods ...

  visitPattern?(node: PatternStep, context: TContext): TResult {
    // Default implementation: visit inline conditions
    for (const patternNode of node.nodes) {
      if (patternNode.where) {
        for (const condition of patternNode.where) {
          this.visitCondition?.(condition, context)
        }
      }
    }
    for (const edge of node.edges) {
      if (edge.where) {
        for (const condition of edge.where) {
          this.visitEdgeCondition?.(condition, context)
        }
      }
    }
    return undefined as TResult
  }
}
```

**Acceptance Criteria:**
- [ ] `visitPattern` in interface
- [ ] Case in switch statement
- [ ] Default implementation handles inline conditions

---

### Task 3.3: Add SubqueryStep Visitor

**Purpose:** Support visiting SubqueryStep nodes with recursive AST traversal.

```typescript
// Add to ASTVisitorInterface
visitSubqueryStep?(node: SubqueryStep, context: TContext): TResult

// Add to visit() switch
case 'subquery':
  return this.visitSubqueryStep?.(node, context)
```

**Add to base visitor class with recursion:**

```typescript
visitSubqueryStep?(node: SubqueryStep, context: TContext): TResult {
  // Recursively visit subquery steps
  for (const step of node.steps) {
    this.visit(step, context)
  }
  return undefined as TResult
}
```

**Acceptance Criteria:**
- [ ] `visitSubqueryStep` in interface
- [ ] Case in switch statement
- [ ] Default implementation recursively visits subquery AST

---

### Task 3.4: Add SubqueryCondition Visitor

**Purpose:** Support visiting SubqueryCondition in WHERE clauses.

```typescript
// Add to existing visitCondition handling
visitCondition?(condition: WhereCondition, context: TContext): TResult {
  switch (condition.type) {
    // ... existing cases ...

    case 'subquery':
      return this.visitSubqueryCondition?.(condition, context)
  }
}

// Add new method
visitSubqueryCondition?(condition: SubqueryCondition, context: TContext): TResult {
  // Recursively visit subquery AST
  for (const step of condition.query) {
    this.visit(step, context)
  }
  return undefined as TResult
}
```

**Acceptance Criteria:**
- [ ] `visitSubqueryCondition` in interface
- [ ] Handler in `visitCondition`
- [ ] Default implementation recursively visits subquery AST

---

### Task 3.5: Add UnwindStep Visitor

**Purpose:** Support visiting UnwindStep nodes.

```typescript
// Add to ASTVisitorInterface
visitUnwind?(node: UnwindStep, context: TContext): TResult

// Add to visit() switch
case 'unwind':
  return this.visitUnwind?.(node, context)
```

**Acceptance Criteria:**
- [ ] `visitUnwind` in interface
- [ ] Case in switch statement

---

### Task 3.6: Add ReturnStep Visitor

**Purpose:** Support visiting ReturnStep nodes with expression traversal.

```typescript
// Add to ASTVisitorInterface
visitReturn?(node: ReturnStep, context: TContext): TResult
visitExpression?(expr: ProjectionExpression, context: TContext): TResult

// Add to visit() switch
case 'return':
  return this.visitReturn?.(node, context)
```

**Add expression visitor:**

```typescript
visitReturn?(node: ReturnStep, context: TContext): TResult {
  for (const ret of node.returns) {
    if (ret.kind === 'expression') {
      this.visitExpression?.(ret.expression, context)
    }
  }
  return undefined as TResult
}

visitExpression?(expr: ProjectionExpression, context: TContext): TResult {
  switch (expr.type) {
    case 'computed':
      for (const operand of expr.operands) {
        this.visitExpression?.(operand, context)
      }
      break
    case 'case':
      for (const branch of expr.branches) {
        this.visitCondition?.(branch.when, context)
        this.visitExpression?.(branch.then, context)
      }
      if (expr.else) {
        this.visitExpression?.(expr.else, context)
      }
      break
    case 'function':
      for (const arg of expr.args) {
        this.visitExpression?.(arg, context)
      }
      break
  }
  return undefined as TResult
}
```

**Acceptance Criteria:**
- [ ] `visitReturn` in interface
- [ ] `visitExpression` in interface
- [ ] Case in switch statement
- [ ] Expression visitor handles recursive structures

---

### Task 3.7: Update Complete visit() Method

**Purpose:** Ensure all cases are handled in the main visit switch.

```typescript
visit(node: ASTNode, context: TContext): TResult | undefined {
  switch (node.type) {
    case 'match':
      return this.visitMatch?.(node, context)
    case 'matchById':
      return this.visitMatchById?.(node, context)
    case 'traversal':
      return this.visitTraversal?.(node, context)
    case 'where':
      return this.visitWhere?.(node, context)
    case 'alias':
      return this.visitAlias?.(node, context)
    case 'branch':
      return this.visitBranch?.(node, context)
    case 'path':
      return this.visitPath?.(node, context)
    case 'aggregate':
      return this.visitAggregate?.(node, context)
    case 'orderBy':
      return this.visitOrderBy?.(node, context)
    case 'limit':
      return this.visitLimit?.(node, context)
    case 'skip':
      return this.visitSkip?.(node, context)
    case 'distinct':
      return this.visitDistinct?.(node, context)
    case 'hierarchy':
      return this.visitHierarchy?.(node, context)
    case 'reachable':
      return this.visitReachable?.(node, context)
    case 'fork':
      return this.visitFork?.(node, context)
    // New v2 types
    case 'pattern':
      return this.visitPattern?.(node, context)
    case 'subquery':
      return this.visitSubqueryStep?.(node, context)
    case 'unwind':
      return this.visitUnwind?.(node, context)
    case 'return':
      return this.visitReturn?.(node, context)
    // Deprecated (keep during migration)
    case 'cursor':
      return this.visitCursor?.(node, context)
    case 'first':
      return this.visitFirst?.(node, context)
    default:
      // Exhaustiveness check
      const _exhaustive: never = node
      throw new Error(`Unknown AST node type: ${(node as any).type}`)
  }
}
```

**Acceptance Criteria:**
- [ ] All new types have cases
- [ ] Missing types (matchById, fork) have cases
- [ ] Exhaustiveness check at end
- [ ] Deprecated types still handled

---

### Task 3.8: Add Visitor for Complete AST Traversal

**Purpose:** Provide a helper to visit all nodes in an AST.

```typescript
/**
 * Visit all nodes in a QueryAST.
 *
 * @example
 * const collector = new AliasCollector()
 * visitAST(queryAST, collector)
 */
export function visitAST<TResult, TContext>(
  ast: QueryAST,
  visitor: ASTVisitorInterface<TResult, TContext>,
  context: TContext,
): void {
  for (const step of ast.steps) {
    visitor.visit?.(step, context)
  }
}

/**
 * Visit all nodes in a step array (for subqueries).
 */
export function visitSteps<TResult, TContext>(
  steps: ASTNode[],
  visitor: ASTVisitorInterface<TResult, TContext>,
  context: TContext,
): void {
  for (const step of steps) {
    visitor.visit?.(step, context)
  }
}
```

**Acceptance Criteria:**
- [ ] `visitAST` helper function exported
- [ ] `visitSteps` helper function exported
- [ ] Works with subquery step arrays

---

## Testing

### Unit Tests

```typescript
// test/ast/visitor-v2.test.ts

import {
  ASTVisitor,
  visitAST,
  type PatternStep,
  type SubqueryStep,
  type ReturnStep,
} from '@astrale/typegraph-core'

describe('AST Visitor v2', () => {
  class StepCollector extends ASTVisitor<void, string[]> {
    visitMatch(node: any, collected: string[]) {
      collected.push('match')
    }
    visitPattern(node: PatternStep, collected: string[]) {
      collected.push('pattern')
    }
    visitSubqueryStep(node: SubqueryStep, collected: string[]) {
      collected.push('subquery')
      // Call parent to recurse
      super.visitSubqueryStep?.(node, collected)
    }
    visitUnwind(node: any, collected: string[]) {
      collected.push('unwind')
    }
    visitReturn(node: ReturnStep, collected: string[]) {
      collected.push('return')
    }
  }

  it('visits PatternStep', () => {
    const visitor = new StepCollector()
    const collected: string[] = []

    visitor.visit({
      type: 'pattern',
      nodes: [{ alias: 'n0', labels: ['User'] }],
      edges: [],
    }, collected)

    expect(collected).toContain('pattern')
  })

  it('visits SubqueryStep recursively', () => {
    const visitor = new StepCollector()
    const collected: string[] = []

    visitor.visit({
      type: 'subquery',
      correlatedAliases: ['n0'],
      steps: [
        { type: 'match', labels: ['Post'], alias: 'p' },
      ],
      exportedAliases: [],
    }, collected)

    expect(collected).toContain('subquery')
    expect(collected).toContain('match') // From recursion
  })

  it('visits UnwindStep', () => {
    const visitor = new StepCollector()
    const collected: string[] = []

    visitor.visit({
      type: 'unwind',
      sourceAlias: 'post',
      field: 'tags',
      itemAlias: 'tag',
    }, collected)

    expect(collected).toContain('unwind')
  })

  it('visits ReturnStep', () => {
    const visitor = new StepCollector()
    const collected: string[] = []

    visitor.visit({
      type: 'return',
      returns: [{ kind: 'alias', alias: 'user' }],
    }, collected)

    expect(collected).toContain('return')
  })

  it('visits all steps with visitAST helper', () => {
    const ast = new QueryAST()
      .addMatch({ labels: ['User'], alias: 'user' })
      .addPattern({ nodes: [], edges: [] })
      .addReturn({ returns: [] })

    const visitor = new StepCollector()
    const collected: string[] = []

    visitAST(ast, visitor, collected)

    expect(collected).toEqual(['match', 'pattern', 'return'])
  })
})
```

---

## Checklist

- [ ] Task 3.1: Add missing visitMatchById and visitFork
- [ ] Task 3.2: Add visitPattern
- [ ] Task 3.3: Add visitSubqueryStep with recursion
- [ ] Task 3.4: Add visitSubqueryCondition
- [ ] Task 3.5: Add visitUnwind
- [ ] Task 3.6: Add visitReturn and visitExpression
- [ ] Task 3.7: Update complete visit() method
- [ ] Task 3.8: Add visitAST and visitSteps helpers
- [ ] Unit tests written
- [ ] All tests passing

---

*Sub-spec version: 1.0*
