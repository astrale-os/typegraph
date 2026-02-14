# Sub-Spec 06: Cypher Compiler - Projection/Return

**File:** `packages/typegraph/src/compiler/cypher/compiler.ts`
**Dependencies:** Sub-Specs 01-02 (AST Types and Builder)
**Estimated Duration:** 1-1.5 days

---

## Overview

This sub-spec covers compilation of ReturnStep and ProjectionExpression, making projection a first-class pipeline step.

---

## Tasks

### Task 6.1: Implement compileReturnStep()

**Purpose:** Compile ReturnStep to RETURN clause.

```typescript
// Location: compiler.ts

/**
 * Compile a ReturnStep to RETURN clause.
 *
 * Handles all return kinds: alias, expression, collect, path
 */
private compileReturnStep(step: ReturnStep): void {
  // Handle special modes first
  if (step.countOnly) {
    this.compileCountOnlyReturn(step)
    return
  }

  if (step.existsOnly) {
    this.compileExistsOnlyReturn(step)
    return
  }

  // Build return expressions
  const returnExprs: string[] = []

  for (const ret of step.returns) {
    const expr = this.compileReturnItem(ret)
    returnExprs.push(expr)
  }

  // Add DISTINCT if needed
  const distinct = this.hasDistinct ? 'DISTINCT ' : ''
  this.clauses.push(`RETURN ${distinct}${returnExprs.join(', ')}`)
}

/**
 * Compile count-only return.
 * Returns: count(alias) AS count
 */
private compileCountOnlyReturn(step: ReturnStep): void {
  const alias = step.returns[0]?.kind === 'alias'
    ? (step.returns[0] as any).alias
    : this.primaryAlias

  this.clauses.push(`RETURN count(${alias}) AS count`)
}

/**
 * Compile exists-only return.
 * Returns: count(alias) > 0 AS exists
 */
private compileExistsOnlyReturn(step: ReturnStep): void {
  const alias = step.returns[0]?.kind === 'alias'
    ? (step.returns[0] as any).alias
    : this.primaryAlias

  this.clauses.push(`RETURN count(${alias}) > 0 AS exists`)
}
```

**Acceptance Criteria:**
- [ ] Handles standard returns
- [ ] Handles countOnly mode
- [ ] Handles existsOnly mode
- [ ] Applies DISTINCT when appropriate

---

### Task 6.2: Implement compileReturnItem()

**Purpose:** Compile individual ProjectionReturn items.

```typescript
/**
 * Compile a single return item.
 */
private compileReturnItem(ret: ProjectionReturn): string {
  switch (ret.kind) {
    case 'alias':
      return this.compileAliasReturn(ret)
    case 'expression':
      return this.compileExpressionReturn(ret)
    case 'collect':
      return this.compileCollectReturn(ret)
    case 'path':
      return this.compilePathReturn(ret)
    default:
      throw new Error(`Unknown return kind: ${(ret as any).kind}`)
  }
}

/**
 * Compile alias return.
 * @example
 * // Full alias: user
 * // With fields: user.name, user.email
 * // With result alias: user AS u
 */
private compileAliasReturn(ret: {
  kind: 'alias'
  alias: string
  fields?: string[]
  resultAlias?: string
}): string {
  if (ret.fields?.length) {
    // Return specific fields
    const fieldExprs = ret.fields.map(f => `${ret.alias}.${f}`)
    return fieldExprs.join(', ')
  }

  // Return full alias
  const resultAlias = ret.resultAlias && ret.resultAlias !== ret.alias
    ? ` AS ${ret.resultAlias}`
    : ''
  return `${ret.alias}${resultAlias}`
}

/**
 * Compile expression return.
 * @example expr AS resultAlias
 */
private compileExpressionReturn(ret: {
  kind: 'expression'
  expression: ProjectionExpression
  resultAlias: string
}): string {
  const exprStr = this.compileExpression(ret.expression)
  return `${exprStr} AS ${ret.resultAlias}`
}

/**
 * Compile collect return.
 * @example collect(alias) AS results, collect(DISTINCT alias) AS uniqueResults
 */
private compileCollectReturn(ret: {
  kind: 'collect'
  sourceAlias: string
  distinct?: boolean
  resultAlias: string
}): string {
  const distinct = ret.distinct ? 'DISTINCT ' : ''
  return `collect(${distinct}${ret.sourceAlias}) AS ${ret.resultAlias}`
}

/**
 * Compile path return.
 * @example p, p AS myPath
 */
private compilePathReturn(ret: {
  kind: 'path'
  pathAlias: string
  resultAlias?: string
}): string {
  const resultAlias = ret.resultAlias && ret.resultAlias !== ret.pathAlias
    ? ` AS ${ret.resultAlias}`
    : ''
  return `${ret.pathAlias}${resultAlias}`
}
```

**Acceptance Criteria:**
- [ ] Handles alias with/without fields
- [ ] Handles alias with result alias
- [ ] Handles expression with result alias
- [ ] Handles collect with/without distinct
- [ ] Handles path with optional result alias

---

### Task 6.3: Implement compileExpression()

**Purpose:** Compile recursive ProjectionExpression to Cypher.

```typescript
/**
 * Compile a projection expression to Cypher.
 */
private compileExpression(expr: ProjectionExpression): string {
  switch (expr.type) {
    case 'field':
      return `${expr.alias}.${expr.field}`

    case 'literal':
      return this.compileLiteralValue(expr.value)

    case 'param':
      return `$${expr.name}`

    case 'computed':
      return this.compileComputedExpression(expr)

    case 'case':
      return this.compileCaseExpression(expr)

    case 'function':
      return this.compileFunctionExpression(expr)

    default:
      throw new Error(`Unknown expression type: ${(expr as any).type}`)
  }
}

/**
 * Compile a literal value.
 */
private compileLiteralValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    const items = value.map(v => this.compileLiteralValue(v))
    return `[${items.join(', ')}]`
  }
  // For objects, use parameter
  const paramName = this.addParam(value)
  return `$${paramName}`
}
```

**Acceptance Criteria:**
- [ ] Handles field expressions
- [ ] Handles literal values (string, number, boolean, null, array)
- [ ] Handles parameter references
- [ ] Recursively handles computed and case expressions

---

### Task 6.4: Implement compileComputedExpression()

**Purpose:** Compile computed operator expressions.

```typescript
/**
 * Compile computed expression with operator.
 */
private compileComputedExpression(expr: {
  type: 'computed'
  operator: ComputedOperator
  operands: ProjectionExpression[]
}): string {
  const operands = expr.operands.map(op => this.compileExpression(op))

  switch (expr.operator) {
    // Arithmetic (binary)
    case 'add':
      return `(${operands[0]} + ${operands[1]})`
    case 'subtract':
      return `(${operands[0]} - ${operands[1]})`
    case 'multiply':
      return `(${operands[0]} * ${operands[1]})`
    case 'divide':
      return `(${operands[0]} / ${operands[1]})`
    case 'modulo':
      return `(${operands[0]} % ${operands[1]})`

    // Type conversions (unary)
    case 'toString':
      return `toString(${operands[0]})`
    case 'toInteger':
      return `toInteger(${operands[0]})`
    case 'toFloat':
      return `toFloat(${operands[0]})`
    case 'toBoolean':
      return `toBoolean(${operands[0]})`

    // String functions
    case 'trim':
      return `trim(${operands[0]})`
    case 'toLower':
      return `toLower(${operands[0]})`
    case 'toUpper':
      return `toUpper(${operands[0]})`
    case 'substring':
      // substring(string, start, length?)
      return operands.length === 3
        ? `substring(${operands[0]}, ${operands[1]}, ${operands[2]})`
        : `substring(${operands[0]}, ${operands[1]})`
    case 'concat':
      return operands.join(' + ')
    case 'split':
      return `split(${operands[0]}, ${operands[1]})`
    case 'replace':
      return `replace(${operands[0]}, ${operands[1]}, ${operands[2]})`

    // Collection functions
    case 'size':
      return `size(${operands[0]})`
    case 'head':
      return `head(${operands[0]})`
    case 'tail':
      return `tail(${operands[0]})`
    case 'last':
      return `last(${operands[0]})`
    case 'reverse':
      return `reverse(${operands[0]})`

    // Null handling
    case 'coalesce':
      return `coalesce(${operands.join(', ')})`
    case 'nullIf':
      return `nullIf(${operands[0]}, ${operands[1]})`

    default:
      throw new Error(`Unknown computed operator: ${expr.operator}`)
  }
}
```

**Acceptance Criteria:**
- [ ] All arithmetic operators
- [ ] All type conversion operators
- [ ] All string functions
- [ ] All collection functions
- [ ] Null handling functions
- [ ] Proper parenthesization for arithmetic

---

### Task 6.5: Implement compileCaseExpression()

**Purpose:** Compile CASE WHEN expressions.

```typescript
/**
 * Compile CASE expression.
 *
 * @example
 * CASE
 *   WHEN condition1 THEN result1
 *   WHEN condition2 THEN result2
 *   ELSE defaultResult
 * END
 */
private compileCaseExpression(expr: {
  type: 'case'
  branches: Array<{ when: WhereCondition; then: ProjectionExpression }>
  else?: ProjectionExpression
}): string {
  const parts: string[] = ['CASE']

  for (const branch of expr.branches) {
    const whenCondition = this.compileCondition(branch.when)
    const thenExpr = this.compileExpression(branch.then)
    parts.push(`WHEN ${whenCondition} THEN ${thenExpr}`)
  }

  if (expr.else) {
    const elseExpr = this.compileExpression(expr.else)
    parts.push(`ELSE ${elseExpr}`)
  }

  parts.push('END')
  return parts.join(' ')
}
```

**Acceptance Criteria:**
- [ ] Compiles CASE with multiple WHEN branches
- [ ] Compiles optional ELSE
- [ ] Conditions compiled correctly

---

### Task 6.6: Implement compileFunctionExpression()

**Purpose:** Compile arbitrary function calls.

```typescript
/**
 * Compile function call expression.
 *
 * @example
 * date(timestamp), duration.between(d1, d2)
 */
private compileFunctionExpression(expr: {
  type: 'function'
  name: string
  args: ProjectionExpression[]
}): string {
  const args = expr.args.map(arg => this.compileExpression(arg))
  return `${expr.name}(${args.join(', ')})`
}
```

**Acceptance Criteria:**
- [ ] Compiles function name with args
- [ ] Supports namespaced functions (duration.between)

---

### Task 6.7: Implement Dual Support for Legacy Projection

**Purpose:** Support both ReturnStep and legacy _projection during migration.

```typescript
// In compile() method

private compile(): CompiledQuery {
  // ... existing setup ...

  // Process steps
  for (const step of this.ast.steps) {
    this.compileStep(step)
  }

  // Check for ReturnStep (new style)
  const returnStep = this.ast.steps.find(s => s.type === 'return') as ReturnStep | undefined

  if (returnStep) {
    // New path: already compiled in compileStep
    // Do nothing here
  } else if (!this.hasBranchStep && this.ast.projection) {
    // Legacy path: compile _projection field
    this.compileProjection(this.ast.projection)
  }

  // ... rest of compilation ...
}

private compileStep(step: ASTNode): void {
  switch (step.type) {
    // ... existing cases ...

    case 'return':
      this.compileReturnStep(step as ReturnStep)
      break

    // ... rest of cases ...
  }
}
```

**Acceptance Criteria:**
- [ ] ReturnStep takes precedence when present
- [ ] Legacy projection still works when no ReturnStep
- [ ] No double RETURN clauses

---

### Task 6.8: Add ReturnStep Placement Validation

**Purpose:** Ensure ReturnStep is only at the end of the pipeline.

```typescript
// In QueryAST.addReturn() or compiler validation

private validateReturnStepPlacement(): void {
  const returnIndex = this.ast.steps.findIndex(s => s.type === 'return')

  if (returnIndex !== -1 && returnIndex !== this.ast.steps.length - 1) {
    throw new Error('ReturnStep must be the last step in the query pipeline')
  }
}
```

**Acceptance Criteria:**
- [ ] Error thrown if ReturnStep not at end
- [ ] Validation runs during compilation or AST construction

---

## Testing

### Unit Tests

```typescript
// test/compiler/return.test.ts

import { CypherCompiler, QueryAST } from '@astrale/typegraph'

describe('ReturnStep Compilation', () => {
  let compiler: CypherCompiler

  beforeEach(() => {
    compiler = new CypherCompiler(schema)
  })

  describe('Basic Returns', () => {
    it('compiles alias return', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({ returns: [{ kind: 'alias', alias: 'user' }] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN user')
    })

    it('compiles alias with fields', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{
            kind: 'alias',
            alias: 'user',
            fields: ['name', 'email'],
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN user.name, user.email')
    })

    it('compiles countOnly', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{ kind: 'alias', alias: 'user' }],
          countOnly: true,
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN count(user) AS count')
    })

    it('compiles existsOnly', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{ kind: 'alias', alias: 'user' }],
          existsOnly: true,
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN count(user) > 0 AS exists')
    })

    it('compiles collect return', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{
            kind: 'collect',
            sourceAlias: 'user',
            distinct: true,
            resultAlias: 'users',
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN collect(DISTINCT user) AS users')
    })
  })

  describe('Expression Returns', () => {
    it('compiles field expression', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{
            kind: 'expression',
            expression: { type: 'field', alias: 'user', field: 'name' },
            resultAlias: 'userName',
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN user.name AS userName')
    })

    it('compiles computed expression', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{
            kind: 'expression',
            expression: {
              type: 'computed',
              operator: 'concat',
              operands: [
                { type: 'field', alias: 'user', field: 'firstName' },
                { type: 'literal', value: ' ' },
                { type: 'field', alias: 'user', field: 'lastName' },
              ],
            },
            resultAlias: 'fullName',
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain("user.firstName + ' ' + user.lastName AS fullName")
    })

    it('compiles arithmetic expression', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['Product'], alias: 'p' })
        .addReturn({
          returns: [{
            kind: 'expression',
            expression: {
              type: 'computed',
              operator: 'multiply',
              operands: [
                { type: 'field', alias: 'p', field: 'price' },
                { type: 'field', alias: 'p', field: 'quantity' },
              ],
            },
            resultAlias: 'total',
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('(p.price * p.quantity) AS total')
    })

    it('compiles CASE expression', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{
            kind: 'expression',
            expression: {
              type: 'case',
              branches: [
                {
                  when: { type: 'comparison', field: 'age', operator: 'lt', value: 18, target: 'user' },
                  then: { type: 'literal', value: 'minor' },
                },
                {
                  when: { type: 'comparison', field: 'age', operator: 'gte', value: 65, target: 'user' },
                  then: { type: 'literal', value: 'senior' },
                },
              ],
              else: { type: 'literal', value: 'adult' },
            },
            resultAlias: 'ageGroup',
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('CASE WHEN')
      expect(result.cypher).toContain('THEN')
      expect(result.cypher).toContain('ELSE')
      expect(result.cypher).toContain('END AS ageGroup')
    })

    it('compiles coalesce expression', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{
            kind: 'expression',
            expression: {
              type: 'computed',
              operator: 'coalesce',
              operands: [
                { type: 'field', alias: 'user', field: 'nickname' },
                { type: 'field', alias: 'user', field: 'name' },
                { type: 'literal', value: 'Anonymous' },
              ],
            },
            resultAlias: 'displayName',
          }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain("coalesce(user.nickname, user.name, 'Anonymous') AS displayName")
    })
  })

  describe('Legacy Compatibility', () => {
    it('uses legacy projection when no ReturnStep', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .setProjection({ mode: 'single', alias: 'user' })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN')
    })

    it('prefers ReturnStep over legacy projection', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .setProjection({ mode: 'single', alias: 'user' })
        .addReturn({
          returns: [{ kind: 'alias', alias: 'user', fields: ['name'] }],
        })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('RETURN user.name')
      expect(result.cypher.match(/RETURN/g)).toHaveLength(1)
    })
  })
})
```

---

## Checklist

- [ ] Task 6.1: compileReturnStep() method
- [ ] Task 6.2: compileReturnItem() for all kinds
- [ ] Task 6.3: compileExpression() base method
- [ ] Task 6.4: compileComputedExpression() with all operators
- [ ] Task 6.5: compileCaseExpression()
- [ ] Task 6.6: compileFunctionExpression()
- [ ] Task 6.7: Dual support for legacy projection
- [ ] Task 6.8: ReturnStep placement validation
- [ ] Unit tests written
- [ ] All tests passing

---

*Sub-spec version: 1.0*
