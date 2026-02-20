// @ts-nocheck
/**
 * AST Builder v2 Methods & Visitor Updates — Specification Tests
 *
 * Tests for pattern matching, subquery steps, subquery WHERE conditions,
 * unwind, return, and ASTVisitor dispatch for the new node types.
 */

import { describe, it, expect } from 'vitest'
import { QueryAST, ASTVisitor } from '../../src/query/ast'
import type {
  ASTNode,
  WhereCondition,
  PatternStep,
  SubqueryStep,
  UnwindStep,
  ReturnStep,
  SubqueryExistsCondition,
  SubqueryNotExistsCondition,
  SubqueryCountCondition,
  ProjectionReturn,
} from '../../src/query/ast'

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Convenience: create a QueryAST already seeded with a MATCH step so that
 * alias n0 is registered (many builder methods validate alias existence).
 */
function seeded(label = 'User'): QueryAST {
  return new QueryAST().addMatch(label)
}

/**
 * Return the last step of an AST.
 */
function lastStep(ast: QueryAST): ASTNode {
  const steps = ast.steps
  return steps[steps.length - 1]
}

// =============================================================================
// addPattern
// =============================================================================

describe('addPattern', () => {
  it('creates PatternStep with correct nodes and edges', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [
        { from: 'a', to: 'b', types: ['AUTHORED'], direction: 'out', optional: false },
      ],
    })

    const step = lastStep(ast) as PatternStep
    expect(step.type).toBe('pattern')
    expect(step.nodes).toHaveLength(2)
    expect(step.edges).toHaveLength(1)
    expect(step.nodes[0].alias).toBe('a')
    expect(step.nodes[1].alias).toBe('b')
    expect(step.edges[0].from).toBe('a')
    expect(step.edges[0].to).toBe('b')
    expect(step.edges[0].types).toEqual(['AUTHORED'])
    expect(step.edges[0].direction).toBe('out')
  })

  it('registers node aliases in alias map', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [],
    })

    const aliasA = ast.aliases.get('a')
    const aliasB = ast.aliases.get('b')

    expect(aliasA).toBeDefined()
    expect(aliasA!.type).toBe('node')
    expect(aliasA!.label).toBe('User')

    expect(aliasB).toBeDefined()
    expect(aliasB!.type).toBe('node')
    expect(aliasB!.label).toBe('Post')
  })

  it('registers edge aliases when present', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [
        {
          alias: 'rel',
          from: 'a',
          to: 'b',
          types: ['AUTHORED'],
          direction: 'out',
          optional: false,
        },
      ],
    })

    const edgeAlias = ast.aliases.get('rel')
    expect(edgeAlias).toBeDefined()
    expect(edgeAlias!.type).toBe('edge')
    expect(edgeAlias!.label).toBe('AUTHORED')
  })

  it('does not register edge alias when edge has no alias', () => {
    const ast = seeded().addPattern({
      nodes: [{ alias: 'a', labels: ['User'] }],
      edges: [
        {
          // no alias field
          from: 'a',
          to: 'a',
          types: ['SELF_REF'],
          direction: 'out',
          optional: false,
        },
      ],
    })

    // Only the seeded n0 and the pattern node 'a' should exist
    expect(ast.aliases.has('a')).toBe(true)
    // No edge alias should be registered
    const edgeEntries = [...ast.aliases.values()].filter((v) => v.type === 'edge')
    expect(edgeEntries).toHaveLength(0)
  })

  it('updates currentAlias to last node in pattern', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'x', labels: ['Org'] },
        { alias: 'y', labels: ['Team'] },
        { alias: 'z', labels: ['Member'] },
      ],
      edges: [],
    })

    expect(ast.currentAlias).toBe('z')
    expect(ast.currentLabel).toBe('Member')
  })

  it('preserves currentAlias when pattern has no nodes', () => {
    const base = seeded()
    const ast = base.addPattern({ nodes: [], edges: [] })

    expect(ast.currentAlias).toBe(base.currentAlias)
  })

  it('sets user alias mappings when userAlias provided on nodes', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'n_author', userAlias: 'author', labels: ['User'] },
        { alias: 'n_post', userAlias: 'post', labels: ['Post'] },
      ],
      edges: [],
    })

    expect(ast.userAliases.get('author')).toBe('n_author')
    expect(ast.userAliases.get('post')).toBe('n_post')
  })

  it('sets edge user alias mappings when userAlias provided on edges', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [
        {
          alias: 'e_wrote',
          userAlias: 'wrote',
          from: 'a',
          to: 'b',
          types: ['AUTHORED'],
          direction: 'out',
          optional: false,
        },
      ],
    })

    expect(ast.edgeUserAliases.get('wrote')).toBe('e_wrote')
  })

  it('pattern with empty edges (standalone nodes)', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'a', labels: ['Foo'] },
        { alias: 'b', labels: ['Bar'] },
      ],
      edges: [],
    })

    const step = lastStep(ast) as PatternStep
    expect(step.edges).toHaveLength(0)
    expect(step.nodes).toHaveLength(2)
  })

  it('pattern with multiple nodes and edges (diamond shape)', () => {
    const ast = seeded().addPattern({
      nodes: [
        { alias: 'a', labels: ['A'] },
        { alias: 'b', labels: ['B'] },
        { alias: 'c', labels: ['C'] },
        { alias: 'd', labels: ['D'] },
      ],
      edges: [
        { from: 'a', to: 'b', types: ['E1'], direction: 'out', optional: false },
        { from: 'a', to: 'c', types: ['E2'], direction: 'out', optional: false },
        { from: 'b', to: 'd', types: ['E3'], direction: 'out', optional: false },
        { from: 'c', to: 'd', types: ['E4'], direction: 'out', optional: false },
      ],
    })

    const step = lastStep(ast) as PatternStep
    expect(step.nodes).toHaveLength(4)
    expect(step.edges).toHaveLength(4)
    // d is the last node
    expect(ast.currentAlias).toBe('d')
  })

  it('pattern stores inline where conditions on nodes', () => {
    const ast = seeded().addPattern({
      nodes: [
        {
          alias: 'a',
          labels: ['User'],
          where: [{ type: 'comparison', field: 'active', operator: 'eq', value: true, target: 'a' }],
        },
      ],
      edges: [],
    })

    const step = lastStep(ast) as PatternStep
    expect(step.nodes[0].where).toHaveLength(1)
    expect(step.nodes[0].where![0].type).toBe('comparison')
  })

  it('addPattern returns a new AST instance (immutability)', () => {
    const base = seeded()
    const ast = base.addPattern({
      nodes: [{ alias: 'a', labels: ['X'] }],
      edges: [],
    })

    expect(ast).not.toBe(base)
    expect(ast.steps.length).toBe(base.steps.length + 1)
    // Original unchanged
    expect(base.steps.length).toBe(1)
  })
})

// =============================================================================
// addSubqueryStep
// =============================================================================

describe('addSubqueryStep', () => {
  it('creates SubqueryStep with correct structure', () => {
    const base = seeded()
    const ast = base.addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [
        { type: 'match', label: 'Post', alias: 'sq0' },
      ],
      exportedAliases: ['postCount'],
    })

    const step = lastStep(ast) as SubqueryStep
    expect(step.type).toBe('subquery')
    expect(step.correlatedAliases).toEqual(['n0'])
    expect(step.steps).toHaveLength(1)
    expect(step.exportedAliases).toEqual(['postCount'])
  })

  it('registers exported aliases as type computed', () => {
    const base = seeded()
    const ast = base.addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [],
      exportedAliases: ['totalPosts', 'avgRating'],
    })

    const totalPosts = ast.aliases.get('totalPosts')
    expect(totalPosts).toBeDefined()
    expect(totalPosts!.type).toBe('computed')
    expect(totalPosts!.label).toBe('')

    const avgRating = ast.aliases.get('avgRating')
    expect(avgRating).toBeDefined()
    expect(avgRating!.type).toBe('computed')
  })

  it('inner steps are stored correctly', () => {
    const innerSteps: ASTNode[] = [
      { type: 'match', label: 'Comment', alias: 'c' },
      { type: 'where', conditions: [{ type: 'comparison', field: 'score', operator: 'gt', value: 5, target: 'c' }] },
    ]

    const ast = seeded().addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: innerSteps,
      exportedAliases: ['commentCount'],
    })

    const step = lastStep(ast) as SubqueryStep
    expect(step.steps).toHaveLength(2)
    expect(step.steps[0].type).toBe('match')
    expect(step.steps[1].type).toBe('where')
  })

  it('preserves correlated aliases', () => {
    const base = seeded('User').addTraversal({
      edges: ['OWNS'],
      direction: 'out',
      toLabels: ['Project'],
      cardinality: 'many',
    })

    const ast = base.addSubqueryStep({
      correlatedAliases: ['n0', base.currentAlias],
      steps: [],
      exportedAliases: [],
    })

    const step = lastStep(ast) as SubqueryStep
    expect(step.correlatedAliases).toContain('n0')
    expect(step.correlatedAliases).toContain(base.currentAlias)
  })

  it('throws when correlated alias does not exist', () => {
    const base = seeded()
    expect(() => {
      base.addSubqueryStep({
        correlatedAliases: ['nonExistent'],
        steps: [],
        exportedAliases: [],
      })
    }).toThrow(/Correlated alias 'nonExistent' does not exist/)
  })

  it('does not change currentAlias', () => {
    const base = seeded()
    const ast = base.addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [],
      exportedAliases: ['result'],
    })

    expect(ast.currentAlias).toBe(base.currentAlias)
  })

  it('returns a new AST instance (immutability)', () => {
    const base = seeded()
    const ast = base.addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [],
      exportedAliases: [],
    })

    expect(ast).not.toBe(base)
  })
})

// =============================================================================
// addWhereExists
// =============================================================================

describe('addWhereExists', () => {
  it('creates WhereStep with SubqueryExistsCondition', () => {
    const base = seeded()
    const ast = base.addWhereExists({
      fromAlias: 'n0',
      subquery: (inner) => inner.addMatch('Post'),
    })

    const step = lastStep(ast)
    expect(step.type).toBe('where')

    const whereStep = step as { type: 'where'; conditions: WhereCondition[] }
    expect(whereStep.conditions).toHaveLength(1)

    const condition = whereStep.conditions[0] as SubqueryExistsCondition
    expect(condition.type).toBe('subquery')
    expect(condition.mode).toBe('exists')
  })

  it('callback receives fresh QueryAST', () => {
    const base = seeded()

    let receivedAst: QueryAST | null = null
    base.addWhereExists({
      fromAlias: 'n0',
      subquery: (inner) => {
        receivedAst = inner
        return inner.addMatch('Post')
      },
    })

    expect(receivedAst).toBeDefined()
    // The fresh AST should have no steps yet
    expect(receivedAst!.steps).toHaveLength(0)
  })

  it('steps from callback are embedded in condition.query', () => {
    const base = seeded()
    const ast = base.addWhereExists({
      fromAlias: 'n0',
      subquery: (inner) =>
        inner.addMatch('Post').addWhere([
          { type: 'comparison', field: 'published', operator: 'eq', value: true, target: 'n0' },
        ]),
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryExistsCondition
    expect(condition.query).toHaveLength(2) // match + where
    expect(condition.query[0].type).toBe('match')
    expect(condition.query[1].type).toBe('where')
  })

  it('correlatedAliases includes fromAlias', () => {
    const base = seeded()
    const ast = base.addWhereExists({
      fromAlias: 'n0',
      subquery: (inner) => inner.addMatch('Post'),
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryExistsCondition
    expect(condition.correlatedAliases).toContain('n0')
  })

  it('returns a new AST instance (immutability)', () => {
    const base = seeded()
    const ast = base.addWhereExists({
      fromAlias: 'n0',
      subquery: (inner) => inner,
    })

    expect(ast).not.toBe(base)
    expect(ast.steps.length).toBe(base.steps.length + 1)
  })
})

// =============================================================================
// addWhereNotExists
// =============================================================================

describe('addWhereNotExists', () => {
  it('creates WhereStep with SubqueryNotExistsCondition (mode: notExists)', () => {
    const base = seeded()
    const ast = base.addWhereNotExists({
      fromAlias: 'n0',
      subquery: (inner) => inner.addMatch('BannedUser'),
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    expect(step.type).toBe('where')
    expect(step.conditions).toHaveLength(1)

    const condition = step.conditions[0] as SubqueryNotExistsCondition
    expect(condition.type).toBe('subquery')
    expect(condition.mode).toBe('notExists')
  })

  it('embeds subquery steps from the callback', () => {
    const base = seeded()
    const ast = base.addWhereNotExists({
      fromAlias: 'n0',
      subquery: (inner) => inner.addMatch('Violation').addLimit(1),
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryNotExistsCondition
    expect(condition.query).toHaveLength(2)
    expect(condition.query[0].type).toBe('match')
    expect(condition.query[1].type).toBe('limit')
  })

  it('correlatedAliases includes fromAlias', () => {
    const base = seeded()
    const ast = base.addWhereNotExists({
      fromAlias: 'n0',
      subquery: (inner) => inner,
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryNotExistsCondition
    expect(condition.correlatedAliases).toEqual(['n0'])
  })
})

// =============================================================================
// addWhereCount
// =============================================================================

describe('addWhereCount', () => {
  it('creates WhereStep with SubqueryCountCondition', () => {
    const base = seeded()
    const ast = base.addWhereCount({
      fromAlias: 'n0',
      subquery: (inner) => inner.addMatch('Post'),
      operator: 'gte',
      value: 3,
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    expect(step.type).toBe('where')
    expect(step.conditions).toHaveLength(1)

    const condition = step.conditions[0] as SubqueryCountCondition
    expect(condition.type).toBe('subquery')
    expect(condition.mode).toBe('count')
  })

  it('count predicate has operator and value', () => {
    const base = seeded()
    const ast = base.addWhereCount({
      fromAlias: 'n0',
      subquery: (inner) => inner.addMatch('Comment'),
      operator: 'lt',
      value: 100,
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryCountCondition
    expect(condition.countPredicate).toBeDefined()
    expect(condition.countPredicate.operator).toBe('lt')
    expect(condition.countPredicate.value).toBe(100)
  })

  it('embeds subquery steps from the callback', () => {
    const base = seeded()
    const ast = base.addWhereCount({
      fromAlias: 'n0',
      subquery: (inner) =>
        inner
          .addMatch('Task')
          .addWhere([
            { type: 'comparison', field: 'status', operator: 'eq', value: 'done', target: 'n0' },
          ]),
      operator: 'eq',
      value: 0,
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryCountCondition
    expect(condition.query).toHaveLength(2)
  })

  it('correlatedAliases includes fromAlias', () => {
    const base = seeded()
    const ast = base.addWhereCount({
      fromAlias: 'n0',
      subquery: (inner) => inner,
      operator: 'eq',
      value: 5,
    })

    const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
    const condition = step.conditions[0] as SubqueryCountCondition
    expect(condition.correlatedAliases).toEqual(['n0'])
  })

  it('supports different comparison operators', () => {
    const operators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const
    const base = seeded()

    for (const op of operators) {
      const ast = base.addWhereCount({
        fromAlias: 'n0',
        subquery: (inner) => inner,
        operator: op,
        value: 1,
      })

      const step = lastStep(ast) as { type: 'where'; conditions: WhereCondition[] }
      const condition = step.conditions[0] as SubqueryCountCondition
      expect(condition.countPredicate.operator).toBe(op)
    }
  })
})

// =============================================================================
// addUnwind
// =============================================================================

describe('addUnwind', () => {
  it('creates UnwindStep with correct fields', () => {
    const base = seeded()
    const ast = base.addUnwind({
      sourceAlias: 'n0',
      field: 'tags',
      itemAlias: 'tag',
    })

    const step = lastStep(ast) as UnwindStep
    expect(step.type).toBe('unwind')
    expect(step.sourceAlias).toBe('n0')
    expect(step.field).toBe('tags')
    expect(step.itemAlias).toBe('tag')
  })

  it('registers itemAlias in alias map as type value', () => {
    const base = seeded()
    const ast = base.addUnwind({
      sourceAlias: 'n0',
      field: 'emails',
      itemAlias: 'email',
    })

    const aliasInfo = ast.aliases.get('email')
    expect(aliasInfo).toBeDefined()
    expect(aliasInfo!.type).toBe('value')
    expect(aliasInfo!.label).toBe('')
  })

  it('preserves source alias reference', () => {
    const base = seeded()
    const ast = base.addUnwind({
      sourceAlias: 'n0',
      field: 'items',
      itemAlias: 'item',
    })

    // The original n0 alias should still exist
    expect(ast.aliases.has('n0')).toBe(true)
    expect(ast.aliases.get('n0')!.type).toBe('node')
  })

  it('throws when source alias does not exist', () => {
    const base = seeded()
    expect(() => {
      base.addUnwind({
        sourceAlias: 'nonExistent',
        field: 'items',
        itemAlias: 'item',
      })
    }).toThrow(/Source alias 'nonExistent' does not exist/)
  })

  it('does not change currentAlias', () => {
    const base = seeded()
    const ast = base.addUnwind({
      sourceAlias: 'n0',
      field: 'tags',
      itemAlias: 'tag',
    })

    expect(ast.currentAlias).toBe(base.currentAlias)
  })

  it('returns a new AST instance (immutability)', () => {
    const base = seeded()
    const ast = base.addUnwind({
      sourceAlias: 'n0',
      field: 'tags',
      itemAlias: 'tag',
    })

    expect(ast).not.toBe(base)
    expect(ast.steps.length).toBe(base.steps.length + 1)
  })

  it('multiple unwinds can coexist', () => {
    const base = seeded()
    const ast = base
      .addUnwind({ sourceAlias: 'n0', field: 'tags', itemAlias: 'tag' })
      .addUnwind({ sourceAlias: 'n0', field: 'emails', itemAlias: 'email' })

    expect(ast.aliases.has('tag')).toBe(true)
    expect(ast.aliases.has('email')).toBe(true)
    expect(ast.steps.filter((s) => s.type === 'unwind')).toHaveLength(2)
  })
})

// =============================================================================
// addReturn
// =============================================================================

describe('addReturn', () => {
  it('creates ReturnStep with alias returns', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.type).toBe('return')
    expect(step.returns).toHaveLength(1)
    expect(step.returns[0].kind).toBe('alias')
    expect((step.returns[0] as any).alias).toBe('n0')
  })

  it('creates ReturnStep with alias returns including field selection', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [{ kind: 'alias', alias: 'n0', fields: ['id', 'name'] }],
    })

    const step = lastStep(ast) as ReturnStep
    const ret = step.returns[0] as ProjectionReturn & { kind: 'alias' }
    expect(ret.fields).toEqual(['id', 'name'])
  })

  it('creates ReturnStep with alias returns including resultAlias', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [{ kind: 'alias', alias: 'n0', resultAlias: 'user' }],
    })

    const step = lastStep(ast) as ReturnStep
    const ret = step.returns[0] as ProjectionReturn & { kind: 'alias' }
    expect(ret.resultAlias).toBe('user')
  })

  it('creates ReturnStep with expression returns', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'field', alias: 'n0', field: 'name' },
          resultAlias: 'userName',
        },
      ],
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.returns).toHaveLength(1)
    expect(step.returns[0].kind).toBe('expression')
    const ret = step.returns[0] as ProjectionReturn & { kind: 'expression' }
    expect(ret.expression.type).toBe('field')
    expect(ret.resultAlias).toBe('userName')
  })

  it('creates ReturnStep with computed expression returns', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [
        {
          kind: 'expression',
          expression: {
            type: 'computed',
            operator: 'add',
            operands: [
              { type: 'field', alias: 'n0', field: 'score' },
              { type: 'literal', value: 10 },
            ],
          },
          resultAlias: 'adjustedScore',
        },
      ],
    })

    const step = lastStep(ast) as ReturnStep
    const ret = step.returns[0] as ProjectionReturn & { kind: 'expression' }
    expect(ret.expression.type).toBe('computed')
  })

  it('creates ReturnStep with collect returns', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [
        {
          kind: 'collect',
          sourceAlias: 'n0',
          distinct: true,
          resultAlias: 'allUsers',
        },
      ],
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.returns).toHaveLength(1)
    expect(step.returns[0].kind).toBe('collect')
    const ret = step.returns[0] as ProjectionReturn & { kind: 'collect' }
    expect(ret.sourceAlias).toBe('n0')
    expect(ret.distinct).toBe(true)
    expect(ret.resultAlias).toBe('allUsers')
  })

  it('creates ReturnStep with path returns', () => {
    const base = seeded()
    // First add a path so the alias exists
    // After addMatch counter=1, addUserAlias doesn't increment, addPath uses nextAlias('p') -> p1
    const withPath = base
      .addUserAlias('target')
      .addPath({
        algorithm: 'shortestPath',
        toAlias: 'n0',
        edge: 'KNOWS',
        direction: 'out',
      })

    const ast = withPath.addReturn({
      returns: [{ kind: 'path', pathAlias: 'p1', resultAlias: 'shortestRoute' }],
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.returns).toHaveLength(1)
    expect(step.returns[0].kind).toBe('path')
    const ret = step.returns[0] as ProjectionReturn & { kind: 'path' }
    expect(ret.pathAlias).toBe('p1')
    expect(ret.resultAlias).toBe('shortestRoute')
  })

  it('countOnly flag', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
      countOnly: true,
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.countOnly).toBe(true)
    expect(step.existsOnly).toBeUndefined()
  })

  it('existsOnly flag', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
      existsOnly: true,
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.existsOnly).toBe(true)
    expect(step.countOnly).toBeUndefined()
  })

  it('multiple return items', () => {
    const base = seeded().addTraversal({
      edges: ['AUTHORED'],
      direction: 'out',
      toLabels: ['Post'],
      cardinality: 'many',
    })

    const ast = base.addReturn({
      returns: [
        { kind: 'alias', alias: 'n0', resultAlias: 'author' },
        { kind: 'alias', alias: base.currentAlias, resultAlias: 'post' },
        {
          kind: 'expression',
          expression: { type: 'literal', value: 42 },
          resultAlias: 'magicNumber',
        },
      ],
    })

    const step = lastStep(ast) as ReturnStep
    expect(step.returns).toHaveLength(3)
    expect(step.returns[0].kind).toBe('alias')
    expect(step.returns[1].kind).toBe('alias')
    expect(step.returns[2].kind).toBe('expression')
  })

  it('throws when alias return references nonexistent alias', () => {
    const base = seeded()
    expect(() => {
      base.addReturn({
        returns: [{ kind: 'alias', alias: 'doesNotExist' }],
      })
    }).toThrow(/Return alias 'doesNotExist' does not exist/)
  })

  it('throws when collect return references nonexistent source alias', () => {
    const base = seeded()
    expect(() => {
      base.addReturn({
        returns: [{ kind: 'collect', sourceAlias: 'missing', resultAlias: 'x', distinct: false }],
      })
    }).toThrow(/Collect source alias 'missing' does not exist/)
  })

  it('throws when path return references nonexistent path alias', () => {
    const base = seeded()
    expect(() => {
      base.addReturn({
        returns: [{ kind: 'path', pathAlias: 'noPath' }],
      })
    }).toThrow(/Path alias 'noPath' does not exist/)
  })

  it('throws when expression references nonexistent alias', () => {
    const base = seeded()
    expect(() => {
      base.addReturn({
        returns: [
          {
            kind: 'expression',
            expression: { type: 'field', alias: 'ghost', field: 'name' },
            resultAlias: 'oops',
          },
        ],
      })
    }).toThrow(/Expression field alias 'ghost' does not exist/)
  })

  it('returns a new AST instance (immutability)', () => {
    const base = seeded()
    const ast = base.addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
    })

    expect(ast).not.toBe(base)
  })
})

// =============================================================================
// ASTVisitor v2
// =============================================================================

describe('ASTVisitor v2', () => {
  /**
   * Concrete visitor that records which visit methods are called and returns
   * a tag string from each.
   */
  class TrackingVisitor extends ASTVisitor<void, string> {
    calls: string[] = []

    visitMatch(node: any, ctx: void) {
      this.calls.push('match')
      return 'match'
    }

    visitTraversal(node: any, ctx: void) {
      this.calls.push('traversal')
      return 'traversal'
    }

    visitWhere(node: any, ctx: void) {
      this.calls.push('where')
      return 'where'
    }

    visitPattern(node: any, ctx: void) {
      this.calls.push('pattern')
      return 'pattern'
    }

    visitSubqueryStep(node: any, ctx: void) {
      this.calls.push('subquery')
      return 'subquery'
    }

    visitUnwind(node: any, ctx: void) {
      this.calls.push('unwind')
      return 'unwind'
    }

    visitReturn(node: any, ctx: void) {
      this.calls.push('return')
      return 'return'
    }

    visitAlias(node: any, ctx: void) {
      this.calls.push('alias')
      return 'alias'
    }

    visitBranch(node: any, ctx: void) {
      this.calls.push('branch')
      return 'branch'
    }

    visitLimit(node: any, ctx: void) {
      this.calls.push('limit')
      return 'limit'
    }

    visitSkip(node: any, ctx: void) {
      this.calls.push('skip')
      return 'skip'
    }

    visitDistinct(node: any, ctx: void) {
      this.calls.push('distinct')
      return 'distinct'
    }

    visitOrderBy(node: any, ctx: void) {
      this.calls.push('orderBy')
      return 'orderBy'
    }
  }

  it('visit() dispatches PatternStep to visitPattern', () => {
    const visitor = new TrackingVisitor()
    const patternNode: PatternStep = {
      type: 'pattern',
      nodes: [{ alias: 'a', labels: ['User'] }],
      edges: [],
    }

    const result = visitor.visit(patternNode, undefined as void)
    expect(result).toBe('pattern')
    expect(visitor.calls).toContain('pattern')
  })

  it('visit() dispatches SubqueryStep to visitSubqueryStep', () => {
    const visitor = new TrackingVisitor()
    const subqueryNode: SubqueryStep = {
      type: 'subquery',
      correlatedAliases: ['n0'],
      steps: [],
      exportedAliases: [],
    }

    const result = visitor.visit(subqueryNode, undefined as void)
    expect(result).toBe('subquery')
    expect(visitor.calls).toContain('subquery')
  })

  it('visit() dispatches UnwindStep to visitUnwind', () => {
    const visitor = new TrackingVisitor()
    const unwindNode: UnwindStep = {
      type: 'unwind',
      sourceAlias: 'n0',
      field: 'tags',
      itemAlias: 'tag',
    }

    const result = visitor.visit(unwindNode, undefined as void)
    expect(result).toBe('unwind')
    expect(visitor.calls).toContain('unwind')
  })

  it('visit() dispatches ReturnStep to visitReturn', () => {
    const visitor = new TrackingVisitor()
    const returnNode: ReturnStep = {
      type: 'return',
      returns: [{ kind: 'alias', alias: 'n0' }],
    }

    const result = visitor.visit(returnNode, undefined as void)
    expect(result).toBe('return')
    expect(visitor.calls).toContain('return')
  })

  it('default visitPattern traverses inline conditions on nodes', () => {
    const conditionCalls: string[] = []

    class ConditionTrackingVisitor extends ASTVisitor<void, string> {
      visitCondition(condition: any, ctx: void): string {
        conditionCalls.push(`condition:${condition.type}`)
        return 'condition'
      }
    }

    const visitor = new ConditionTrackingVisitor()
    const patternNode: PatternStep = {
      type: 'pattern',
      nodes: [
        {
          alias: 'a',
          labels: ['User'],
          where: [
            { type: 'comparison', field: 'active', operator: 'eq', value: true, target: 'a' },
          ],
        },
      ],
      edges: [],
    }

    // Call the default implementation
    visitor.visitPattern!(patternNode, undefined as void)
    expect(conditionCalls).toContain('condition:comparison')
  })

  it('default visitPattern traverses inline conditions on edges', () => {
    const edgeConditionCalls: string[] = []

    class EdgeConditionTrackingVisitor extends ASTVisitor<void, string> {
      visitEdgeCondition(condition: any, ctx: void): string {
        edgeConditionCalls.push(`edgeCondition:${condition.field}`)
        return 'edgeCondition'
      }
    }

    const visitor = new EdgeConditionTrackingVisitor()
    const patternNode: PatternStep = {
      type: 'pattern',
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [
        {
          from: 'a',
          to: 'b',
          types: ['AUTHORED'],
          direction: 'out',
          optional: false,
          where: [{ field: 'role', operator: 'eq', value: 'primary' }],
        },
      ],
    }

    visitor.visitPattern!(patternNode, undefined as void)
    expect(edgeConditionCalls).toContain('edgeCondition:role')
  })

  it('default visitSubqueryStep recursively visits inner steps', () => {
    class RecursiveVisitor extends ASTVisitor<void, string> {
      calls: string[] = []

      visitMatch(node: any, ctx: void) {
        this.calls.push('match')
        return 'match'
      }

      visitWhere(node: any, ctx: void) {
        this.calls.push('where')
        return 'where'
      }
    }

    const visitor = new RecursiveVisitor()
    const subqueryNode: SubqueryStep = {
      type: 'subquery',
      correlatedAliases: [],
      steps: [
        { type: 'match', label: 'Post', alias: 'sq0' },
        {
          type: 'where',
          conditions: [
            { type: 'comparison', field: 'published', operator: 'eq', value: true, target: 'sq0' },
          ],
        },
      ],
      exportedAliases: [],
    }

    // Use the default visitSubqueryStep which recurses into inner steps
    visitor.visitSubqueryStep!(subqueryNode, undefined as void)
    expect(visitor.calls).toContain('match')
    expect(visitor.calls).toContain('where')
  })

  it('default visitReturn visits expressions in return items', () => {
    const expressionCalls: string[] = []

    class ExpressionVisitor extends ASTVisitor<void, string> {
      visitExpression(expr: any, ctx: void): string {
        expressionCalls.push(`expression:${expr.type}`)
        // Call super to get default recursive behavior
        return super.visitExpression!(expr, ctx)
      }
    }

    const visitor = new ExpressionVisitor()
    const returnNode: ReturnStep = {
      type: 'return',
      returns: [
        { kind: 'alias', alias: 'n0' },
        {
          kind: 'expression',
          expression: { type: 'field', alias: 'n0', field: 'name' },
          resultAlias: 'name',
        },
      ],
    }

    visitor.visitReturn!(returnNode, undefined as void)
    expect(expressionCalls).toContain('expression:field')
  })

  it('default visitReturn skips non-expression return items', () => {
    const expressionCalls: string[] = []

    class ExpressionVisitor extends ASTVisitor<void, string> {
      visitExpression(expr: any, ctx: void): string {
        expressionCalls.push(`expression:${expr.type}`)
        return 'expression'
      }
    }

    const visitor = new ExpressionVisitor()
    const returnNode: ReturnStep = {
      type: 'return',
      returns: [
        { kind: 'alias', alias: 'n0' },
        { kind: 'collect', sourceAlias: 'n0', resultAlias: 'all', distinct: false },
      ],
    }

    visitor.visitReturn!(returnNode, undefined as void)
    // No expressions to visit
    expect(expressionCalls).toHaveLength(0)
  })

  it('visitCondition handles subquery type -> visitSubqueryCondition', () => {
    const subqueryCalls: string[] = []

    class SubqueryConditionVisitor extends ASTVisitor<void, string> {
      visitSubqueryCondition(condition: any, ctx: void): string {
        subqueryCalls.push(`subqueryCondition:${condition.mode}`)
        return 'subqueryCondition'
      }
    }

    const visitor = new SubqueryConditionVisitor()
    const condition: SubqueryExistsCondition = {
      type: 'subquery',
      mode: 'exists',
      query: [{ type: 'match', label: 'Post', alias: 'sq0' }],
      correlatedAliases: ['n0'],
    }

    visitor.visitCondition!(condition, undefined as void)
    expect(subqueryCalls).toContain('subqueryCondition:exists')
  })

  it('visitCondition recursively processes logical conditions', () => {
    const conditionCalls: string[] = []

    class LogicalVisitor extends ASTVisitor<void, string> {
      visitCondition(condition: any, ctx: void): string {
        conditionCalls.push(`condition:${condition.type}`)
        return super.visitCondition!(condition, ctx)
      }
    }

    const visitor = new LogicalVisitor()
    const logicalCondition: WhereCondition = {
      type: 'logical',
      operator: 'AND',
      conditions: [
        { type: 'comparison', field: 'a', operator: 'eq', value: 1, target: 'n0' },
        { type: 'comparison', field: 'b', operator: 'eq', value: 2, target: 'n0' },
      ],
    }

    visitor.visitCondition!(logicalCondition, undefined as void)
    // logical + 2 comparison subconditions
    expect(conditionCalls.filter((c) => c === 'condition:logical')).toHaveLength(1)
    expect(conditionCalls.filter((c) => c === 'condition:comparison')).toHaveLength(2)
  })

  it('default visitSubqueryCondition recursively visits query steps', () => {
    class SubqueryRecursiveVisitor extends ASTVisitor<void, string> {
      calls: string[] = []

      visitMatch(node: any, ctx: void) {
        this.calls.push('match')
        return 'match'
      }
    }

    const visitor = new SubqueryRecursiveVisitor()
    const condition: SubqueryExistsCondition = {
      type: 'subquery',
      mode: 'exists',
      query: [
        { type: 'match', label: 'Comment', alias: 'sq0' },
      ],
      correlatedAliases: ['n0'],
    }

    visitor.visitSubqueryCondition!(condition, undefined as void)
    expect(visitor.calls).toContain('match')
  })

  it('visitAll collects results from new v2 step types', () => {
    const visitor = new TrackingVisitor()

    const ast = seeded()
      .addPattern({
        nodes: [{ alias: 'a', labels: ['User'] }],
        edges: [],
      })
      .addUnwind({ sourceAlias: 'n0', field: 'tags', itemAlias: 'tag' })
      .addReturn({ returns: [{ kind: 'alias', alias: 'n0' }] })

    const results = visitor.visitAll(ast, undefined as void)

    expect(visitor.calls).toContain('match')
    expect(visitor.calls).toContain('pattern')
    expect(visitor.calls).toContain('unwind')
    expect(visitor.calls).toContain('return')
    expect(results).toContain('match')
    expect(results).toContain('pattern')
    expect(results).toContain('unwind')
    expect(results).toContain('return')
  })

  it('visitAll collects results from subquery steps in pipeline', () => {
    const visitor = new TrackingVisitor()

    const base = seeded()
    const ast = base.addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [{ type: 'match', label: 'Post', alias: 'sq0' }],
      exportedAliases: ['postCount'],
    })

    const results = visitor.visitAll(ast, undefined as void)

    expect(visitor.calls).toContain('match')
    expect(visitor.calls).toContain('subquery')
    expect(results).toContain('subquery')
  })

  it('visit() throws for unknown type (exhaustiveness)', () => {
    const visitor = new TrackingVisitor()
    const unknownNode = { type: 'bogusType' } as any

    expect(() => {
      visitor.visit(unknownNode, undefined as void)
    }).toThrow(/Unknown AST node type/)
  })

  it('visitExpression recursively processes computed expressions', () => {
    const expressionCalls: string[] = []

    class DeepExprVisitor extends ASTVisitor<void, string> {
      visitExpression(expr: any, ctx: void): string {
        expressionCalls.push(`expr:${expr.type}`)
        return super.visitExpression!(expr, ctx)
      }
    }

    const visitor = new DeepExprVisitor()
    visitor.visitExpression!(
      {
        type: 'computed',
        operator: 'add',
        operands: [
          { type: 'field', alias: 'n0', field: 'x' },
          { type: 'literal', value: 1 },
        ],
      },
      undefined as void,
    )

    expect(expressionCalls).toContain('expr:computed')
    expect(expressionCalls).toContain('expr:field')
    expect(expressionCalls).toContain('expr:literal')
  })

  it('visitExpression recursively processes case expressions', () => {
    const expressionCalls: string[] = []
    const conditionCalls: string[] = []

    class CaseExprVisitor extends ASTVisitor<void, string> {
      visitExpression(expr: any, ctx: void): string {
        expressionCalls.push(`expr:${expr.type}`)
        return super.visitExpression!(expr, ctx)
      }

      visitCondition(condition: any, ctx: void): string {
        conditionCalls.push(`cond:${condition.type}`)
        return super.visitCondition!(condition, ctx)
      }
    }

    const visitor = new CaseExprVisitor()
    visitor.visitExpression!(
      {
        type: 'case',
        branches: [
          {
            when: { type: 'comparison', field: 'status', operator: 'eq', value: 'active', target: 'n0' },
            then: { type: 'literal', value: 'yes' },
          },
        ],
        else: { type: 'literal', value: 'no' },
      },
      undefined as void,
    )

    expect(expressionCalls).toContain('expr:case')
    expect(expressionCalls).toContain('expr:literal')
    expect(conditionCalls).toContain('cond:comparison')
  })

  it('visitExpression recursively processes function expressions', () => {
    const expressionCalls: string[] = []

    class FuncExprVisitor extends ASTVisitor<void, string> {
      visitExpression(expr: any, ctx: void): string {
        expressionCalls.push(`expr:${expr.type}`)
        return super.visitExpression!(expr, ctx)
      }
    }

    const visitor = new FuncExprVisitor()
    visitor.visitExpression!(
      {
        type: 'function',
        name: 'toUpper',
        args: [{ type: 'field', alias: 'n0', field: 'name' }],
      },
      undefined as void,
    )

    expect(expressionCalls).toContain('expr:function')
    expect(expressionCalls).toContain('expr:field')
  })
})

// =============================================================================
// INTEGRATION: chaining v2 methods together
// =============================================================================

describe('v2 method chaining integration', () => {
  it('pattern -> where exists -> return', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addPattern({
        nodes: [
          { alias: 'u', labels: ['User'] },
          { alias: 'p', labels: ['Project'] },
        ],
        edges: [
          { from: 'u', to: 'p', types: ['OWNS'], direction: 'out', optional: false },
        ],
      })
      .addWhereExists({
        fromAlias: 'u',
        subquery: (inner) => inner.addMatch('Task'),
      })
      .addReturn({
        returns: [
          { kind: 'alias', alias: 'u' },
          { kind: 'alias', alias: 'p' },
        ],
      })

    expect(ast.steps).toHaveLength(4) // match + pattern + where + return
    expect(ast.steps[0].type).toBe('match')
    expect(ast.steps[1].type).toBe('pattern')
    expect(ast.steps[2].type).toBe('where')
    expect(ast.steps[3].type).toBe('return')
  })

  it('match -> subquery -> unwind -> return', () => {
    const base = seeded()
    const ast = base
      .addSubqueryStep({
        correlatedAliases: ['n0'],
        steps: [
          { type: 'match', label: 'Tag', alias: 'sq0' },
        ],
        exportedAliases: ['tagList'],
      })
      .addUnwind({
        sourceAlias: 'tagList',
        field: 'items',
        itemAlias: 'singleTag',
      })
      .addReturn({
        returns: [
          { kind: 'alias', alias: 'n0' },
        ],
      })

    expect(ast.steps).toHaveLength(4) // match + subquery + unwind + return
    expect(ast.aliases.has('tagList')).toBe(true)
    expect(ast.aliases.get('tagList')!.type).toBe('computed')
    expect(ast.aliases.has('singleTag')).toBe(true)
    expect(ast.aliases.get('singleTag')!.type).toBe('value')
  })

  it('match -> whereCount -> whereNotExists -> return with countOnly', () => {
    const ast = seeded()
      .addWhereCount({
        fromAlias: 'n0',
        subquery: (inner) => inner.addMatch('Post'),
        operator: 'gte',
        value: 5,
      })
      .addWhereNotExists({
        fromAlias: 'n0',
        subquery: (inner) => inner.addMatch('Ban'),
      })
      .addReturn({
        returns: [{ kind: 'alias', alias: 'n0' }],
        countOnly: true,
      })

    expect(ast.steps).toHaveLength(4) // match + where(count) + where(notExists) + return

    const countWhere = ast.steps[1] as { type: 'where'; conditions: WhereCondition[] }
    const countCondition = countWhere.conditions[0] as SubqueryCountCondition
    expect(countCondition.mode).toBe('count')

    const notExistsWhere = ast.steps[2] as { type: 'where'; conditions: WhereCondition[] }
    const notExistsCondition = notExistsWhere.conditions[0] as SubqueryNotExistsCondition
    expect(notExistsCondition.mode).toBe('notExists')

    const returnStep = ast.steps[3] as ReturnStep
    expect(returnStep.countOnly).toBe(true)
  })

  it('all v2 steps are visited by visitAll', () => {
    class FullTracker extends ASTVisitor<void, string> {
      types: string[] = []

      visitMatch() { this.types.push('match'); return 'match' }
      visitPattern() { this.types.push('pattern'); return 'pattern' }
      visitSubqueryStep() { this.types.push('subquery'); return 'subquery' }
      visitWhere() { this.types.push('where'); return 'where' }
      visitUnwind() { this.types.push('unwind'); return 'unwind' }
      visitReturn() { this.types.push('return'); return 'return' }
    }

    const ast = seeded()
      .addPattern({
        nodes: [{ alias: 'x', labels: ['X'] }],
        edges: [],
      })
      .addSubqueryStep({
        correlatedAliases: ['n0'],
        steps: [],
        exportedAliases: ['res'],
      })
      .addWhere([
        { type: 'comparison', field: 'a', operator: 'eq', value: 1, target: 'n0' },
      ])
      .addUnwind({ sourceAlias: 'res', field: 'items', itemAlias: 'item' })
      .addReturn({ returns: [{ kind: 'alias', alias: 'n0' }] })

    const visitor = new FullTracker()
    visitor.visitAll(ast, undefined as void)

    expect(visitor.types).toEqual([
      'match',
      'pattern',
      'subquery',
      'where',
      'unwind',
      'return',
    ])
  })
})
