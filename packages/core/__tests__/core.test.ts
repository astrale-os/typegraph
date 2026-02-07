/**
 * Core Definition Tests
 *
 * Tests for defineCore(), toCoreSnapshot(), validateEdgeTupleUniqueness(), and diffCore().
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  node,
  edge,
  defineSchema,
  defineCore,
  toCoreSnapshot,
  diffCore,
  validateEdgeTupleUniqueness,
  SchemaValidationError,
} from '../src'
import type { CoreRefs, CoreSnapshot } from '../src'

// =============================================================================
// TEST SCHEMAS
// =============================================================================

const simpleSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string(),
        name: z.string(),
      },
      indexes: ['email', { property: 'name', type: 'fulltext' }],
    }),
    space: node({
      properties: {
        name: z.string(),
      },
    }),
  },
  edges: {
    owns: edge({
      from: 'user',
      to: 'space',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
      properties: {
        since: z.date(),
      },
    }),
  },
})

const inheritanceSchema = defineSchema({
  nodes: {
    entity: node({
      properties: {
        createdAt: z.date(),
      },
    }),
    user: node({
      properties: {
        email: z.string(),
      },
      labels: ['entity'],
    }),
    admin: node({
      properties: {
        role: z.string(),
      },
      labels: ['user'],
    }),
    space: node({
      properties: {
        name: z.string(),
      },
      labels: ['entity'],
    }),
  },
  edges: {
    hasParent: edge({
      from: 'entity',
      to: 'entity',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
})

/** Schema with Zod defaults, transforms, optionals */
const zodFeaturesSchema = defineSchema({
  nodes: {
    config: node({
      properties: {
        label: z.string(),
        enabled: z.boolean().default(true),
        priority: z.number().optional(),
        tag: z.string().transform((s) => s.toUpperCase()),
      },
    }),
  },
  edges: {},
})

/** Schema with indexed edge properties */
const indexedEdgeSchema = defineSchema({
  nodes: {
    user: node({ properties: { name: z.string() } }),
    resource: node({ properties: { name: z.string() } }),
  },
  edges: {
    access: edge({
      from: 'user',
      to: 'resource',
      cardinality: { outbound: 'many', inbound: 'many' },
      properties: { role: z.string(), grantedAt: z.date() },
      indexes: ['role'],
    }),
  },
})

// =============================================================================
// defineCore TESTS
// =============================================================================

describe('defineCore', () => {
  it('creates a valid core with nodes and edges', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        defaultSpace: { kind: 'space', properties: { name: 'Default' } },
      },
      edges: [{ kind: 'owns', from: 'admin', to: 'defaultSpace' }],
    })

    expect(core.schema).toBe(simpleSchema)
    expect(Object.keys(core.config.nodes)).toEqual(['admin', 'defaultSpace'])
    expect(core.config.edges).toHaveLength(1)
  })

  it('creates an empty core', () => {
    const core = defineCore(simpleSchema, {
      nodes: {},
      edges: [],
    })

    expect(Object.keys(core.config.nodes)).toEqual([])
    expect(core.config.edges).toHaveLength(0)
  })

  it('preserves kind type on CoreRefs', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        defaultSpace: { kind: 'space', properties: { name: 'Default' } },
      },
      edges: [],
    })

    // Type-level test: CoreRefs should infer correctly
    type Refs = CoreRefs<typeof core>
    type AdminKind = Refs['admin']['kind']
    type SpaceKind = Refs['defaultSpace']['kind']

    // These are compile-time checks — if they compile, the types are correct
    const _adminKind: AdminKind = 'user'
    const _spaceKind: SpaceKind = 'space'
    expect(_adminKind).toBe('user')
    expect(_spaceKind).toBe('space')
  })

  // --- Validation error tests ---

  it('rejects unknown node kind', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          // @ts-expect-error — 'unknown' is not a valid node kind
          bad: { kind: 'unknown', properties: {} },
        },
        edges: [],
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects invalid node properties', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          // @ts-expect-error — missing required 'name' property
          admin: { kind: 'user', properties: { email: 'admin@ex.com' } },
        },
        edges: [],
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects unknown edge kind', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        },
        edges: [
          // @ts-expect-error — 'unknown' is not a valid edge kind
          { kind: 'unknown', from: 'admin', to: 'admin' },
        ],
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects edge referencing non-existent node key', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        },
        edges: [
          // @ts-expect-error — 'missing' is not a node key
          { kind: 'owns', from: 'admin', to: 'missing' },
        ],
      }),
    ).toThrow(/non-existent target node/)
  })

  it('rejects edge with wrong endpoint kind', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
          otherUser: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
        },
        edges: [
          // 'owns' requires from: 'user', to: 'space' — but 'otherUser' is kind 'user', not 'space'
          { kind: 'owns', from: 'admin', to: 'otherUser' },
        ],
      }),
    ).toThrow(/requires to/)
  })

  it('rejects cardinality violation (inbound one)', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
          other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
          space: { kind: 'space', properties: { name: 'Default' } },
        },
        edges: [
          // 'owns' has inbound 'one' — space can have at most 1 incoming 'owns' edge
          { kind: 'owns', from: 'admin', to: 'space' },
          { kind: 'owns', from: 'other', to: 'space' },
        ],
      }),
    ).toThrow(/Cardinality violation/)
  })

  // --- Label inheritance tests ---

  it('validates edge endpoints with label inheritance', () => {
    // 'hasParent' is from: 'entity', to: 'entity'
    // 'user' labels: ['entity'], so user satisfies entity
    const core = defineCore(inheritanceSchema, {
      nodes: {
        admin: {
          kind: 'admin',
          properties: { role: 'superadmin', email: 'admin@ex.com', createdAt: new Date() },
        },
        space: {
          kind: 'space',
          properties: { name: 'Root', createdAt: new Date() },
        },
      },
      edges: [
        // admin (→ user → entity) satisfies 'entity' endpoint
        { kind: 'hasParent', from: 'admin', to: 'space' },
      ],
    })

    expect(core.config.edges).toHaveLength(1)
  })

  // --- Edge properties tests ---

  it('allows edges without properties when edge has none', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        space: { kind: 'space', properties: { name: 'Default' } },
      },
      edges: [
        { kind: 'owns', from: 'admin', to: 'space' },
      ],
    })
    expect(core.config.edges).toHaveLength(1)
  })

  it('requires properties on edges that define them', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
          other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
        },
        edges: [
          // 'follows' has required 'since' property — omitting it is caught at runtime
          { kind: 'follows', from: 'admin', to: 'other' },
        ],
      }),
    ).toThrow(SchemaValidationError)
  })

  it('validates edge properties with Zod', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date() } },
      ],
    })
    expect(core.config.edges).toHaveLength(1)
  })

  // --- Duplicate edge tuple tests ---

  it('rejects duplicate edge tuple', () => {
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
          other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
        },
        edges: [
          { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2024-01-01') } },
          { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2025-01-01') } },
        ],
      }),
    ).toThrow(SchemaValidationError)
  })

  it('validation order: cardinality fires before tuple uniqueness', () => {
    // 'owns' has inbound 'one', so two 'owns' edges to the same space violates cardinality.
    // This also duplicates the tuple. Cardinality should fire first.
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
          space: { kind: 'space', properties: { name: 'Default' } },
        },
        edges: [
          { kind: 'owns', from: 'admin', to: 'space' },
          { kind: 'owns', from: 'admin', to: 'space' },
        ],
      }),
    ).toThrow(/Cardinality violation/)
  })

  it('existing validations still work after edge uniqueness addition', () => {
    // Kind validation
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          // @ts-expect-error — bad kind
          bad: { kind: 'nope', properties: {} },
        },
        edges: [],
      }),
    ).toThrow(SchemaValidationError)

    // Cardinality
    expect(() =>
      defineCore(simpleSchema, {
        nodes: {
          a: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
          b: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
          s: { kind: 'space', properties: { name: 'S' } },
        },
        edges: [
          { kind: 'owns', from: 'a', to: 's' },
          { kind: 'owns', from: 'b', to: 's' },
        ],
      }),
    ).toThrow(/Cardinality/)
  })
})

// =============================================================================
// toCoreSnapshot TESTS
// =============================================================================

describe('toCoreSnapshot', () => {
  it('snapshots simple core with string properties', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        space: { kind: 'space', properties: { name: 'Default' } },
      },
      edges: [{ kind: 'owns', from: 'admin', to: 'space' }],
    })

    const snapshot = toCoreSnapshot(core)

    expect(snapshot.nodes.admin.kind).toBe('user')
    expect(snapshot.nodes.admin.properties.email).toBe('admin@ex.com')
    expect(snapshot.nodes.admin.properties.name).toBe('Admin')
    expect(snapshot.nodes.space.kind).toBe('space')
    expect(snapshot.nodes.space.properties.name).toBe('Default')
    expect(snapshot.edges).toHaveLength(1)
    expect(snapshot.edges[0].kind).toBe('owns')
    expect(snapshot.edges[0].from).toBe('admin')
    expect(snapshot.edges[0].to).toBe('space')
  })

  it('applies Zod .default() values', () => {
    const core = defineCore(zodFeaturesSchema, {
      nodes: {
        myConfig: {
          kind: 'config',
          properties: { label: 'test', tag: 'hello' },
        },
      },
      edges: [],
    })

    const snapshot = toCoreSnapshot(core)

    // 'enabled' was omitted (has .default(true)) — snapshot should have it filled in
    expect(snapshot.nodes.myConfig.properties.enabled).toBe(true)
  })

  it('applies Zod .transform() values', () => {
    const core = defineCore(zodFeaturesSchema, {
      nodes: {
        myConfig: {
          kind: 'config',
          properties: { label: 'test', enabled: false, tag: 'hello' },
        },
      },
      edges: [],
    })

    const snapshot = toCoreSnapshot(core)

    expect(snapshot.nodes.myConfig.properties.tag).toBe('HELLO')
  })

  it('handles z.optional() with undefined', () => {
    const core = defineCore(zodFeaturesSchema, {
      nodes: {
        myConfig: {
          kind: 'config',
          properties: { label: 'test', enabled: true, tag: 'x' },
        },
      },
      edges: [],
    })

    const snapshot = toCoreSnapshot(core)

    // priority is optional and not provided — should be undefined or absent
    expect(snapshot.nodes.myConfig.properties.priority).toBeUndefined()
  })

  it('handles z.optional() with explicit value', () => {
    const core = defineCore(zodFeaturesSchema, {
      nodes: {
        myConfig: {
          kind: 'config',
          properties: { label: 'test', enabled: true, priority: 42, tag: 'x' },
        },
      },
      edges: [],
    })

    const snapshot = toCoreSnapshot(core)

    expect(snapshot.nodes.myConfig.properties.priority).toBe(42)
  })

  it('preserves Date via structuredClone', () => {
    const date = new Date('2024-06-15T12:00:00Z')
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: date } },
      ],
    })

    const snapshot = toCoreSnapshot(core)

    expect(snapshot.edges[0].properties?.since).toBeInstanceOf(Date)
    expect((snapshot.edges[0].properties?.since as Date).getTime()).toBe(date.getTime())
  })

  it('deep copy: array mutation does not affect snapshot', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
      },
      edges: [],
    })

    const snapshot = toCoreSnapshot(core)
    const originalEmail = snapshot.nodes.admin.properties.email

    // Mutate the original core's properties — should not affect snapshot
    ;(core.config.nodes.admin.properties as Record<string, unknown>).email = 'changed@ex.com'

    expect(snapshot.nodes.admin.properties.email).toBe(originalEmail)
  })

  it('deep copy: object mutation does not affect snapshot', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
      },
      edges: [],
    })

    const snapshot1 = toCoreSnapshot(core)
    const snapshot2 = toCoreSnapshot(core)

    // Mutate snapshot1 — should not affect snapshot2
    ;(snapshot1.nodes.admin.properties as Record<string, unknown>).email = 'mutated@ex.com'

    expect(snapshot2.nodes.admin.properties.email).toBe('admin@ex.com')
  })

  it('empty core (no nodes, no edges)', () => {
    const core = defineCore(simpleSchema, { nodes: {}, edges: [] })

    const snapshot = toCoreSnapshot(core)

    expect(Object.keys(snapshot.nodes)).toHaveLength(0)
    expect(snapshot.edges).toHaveLength(0)
  })

  it('edge with no properties', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        space: { kind: 'space', properties: { name: 'S' } },
      },
      edges: [{ kind: 'owns', from: 'admin', to: 'space' }],
    })

    const snapshot = toCoreSnapshot(core)

    expect(snapshot.edges[0].kind).toBe('owns')
    // 'owns' has no properties defined — should be absent or empty
    expect(snapshot.edges[0].properties).toBeUndefined()
  })

  it('edge with properties', () => {
    const date = new Date('2024-01-01')
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: date } },
      ],
    })

    const snapshot = toCoreSnapshot(core)

    expect(snapshot.edges[0].properties).toBeDefined()
    expect(snapshot.edges[0].properties?.since).toBeInstanceOf(Date)
  })

  it('JSON-serializable roundtrip (string values)', () => {
    const core = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        space: { kind: 'space', properties: { name: 'S' } },
      },
      edges: [{ kind: 'owns', from: 'admin', to: 'space' }],
    })

    const snapshot = toCoreSnapshot(core)
    const json = JSON.stringify(snapshot)
    const parsed = JSON.parse(json)

    expect(parsed.nodes.admin.kind).toBe('user')
    expect(parsed.nodes.admin.properties.email).toBe('a@ex.com')
    expect(parsed.edges[0].kind).toBe('owns')
  })

  it('throws SchemaValidationError for unknown node kind', () => {
    const badCore = {
      schema: simpleSchema,
      config: {
        nodes: { bad: { kind: 'nonexistent', properties: {} } },
        edges: [],
      },
    }

    expect(() => toCoreSnapshot(badCore as any)).toThrow(SchemaValidationError)
    expect(() => toCoreSnapshot(badCore as any)).toThrow(/does not exist in schema/)
  })

  it('throws SchemaValidationError for unknown edge kind', () => {
    const badCore = {
      schema: simpleSchema,
      config: {
        nodes: {
          admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        },
        edges: [{ kind: 'nonexistent', from: 'admin', to: 'admin' }],
      },
    }

    expect(() => toCoreSnapshot(badCore as any)).toThrow(SchemaValidationError)
    expect(() => toCoreSnapshot(badCore as any)).toThrow(/does not exist in schema/)
  })
})

// =============================================================================
// validateEdgeTupleUniqueness TESTS
// =============================================================================

describe('validateEdgeTupleUniqueness', () => {
  it('no edges — valid', () => {
    expect(() => validateEdgeTupleUniqueness([])).not.toThrow()
  })

  it('distinct edges (different kinds, same endpoints) — valid', () => {
    expect(() =>
      validateEdgeTupleUniqueness([
        { kind: 'owns', from: 'a', to: 'b' },
        { kind: 'follows', from: 'a', to: 'b' },
      ]),
    ).not.toThrow()
  })

  it('same kind, different endpoints — valid', () => {
    expect(() =>
      validateEdgeTupleUniqueness([
        { kind: 'follows', from: 'a', to: 'b' },
        { kind: 'follows', from: 'a', to: 'c' },
        { kind: 'follows', from: 'b', to: 'a' },
      ]),
    ).not.toThrow()
  })

  it('duplicate tuple — throws SchemaValidationError', () => {
    expect(() =>
      validateEdgeTupleUniqueness([
        { kind: 'follows', from: 'a', to: 'b' },
        { kind: 'follows', from: 'a', to: 'b' },
      ]),
    ).toThrow(SchemaValidationError)

    try {
      validateEdgeTupleUniqueness([
        { kind: 'follows', from: 'a', to: 'b' },
        { kind: 'follows', from: 'a', to: 'b' },
      ])
    } catch (e) {
      expect((e as Error).message).toContain('follows')
      expect((e as Error).message).toContain("from 'a'")
      expect((e as Error).message).toContain("to 'b'")
    }
  })

  it('duplicate with different properties — throws (properties do not affect identity)', () => {
    // The function signature only inspects (kind, from, to) — extra fields on the
    // objects are structurally allowed but irrelevant to identity. Two edges with the
    // same tuple are duplicates regardless of any other data they carry.
    expect(() =>
      validateEdgeTupleUniqueness([
        { kind: 'access', from: 'u1', to: 'r1' },
        { kind: 'access', from: 'u1', to: 'r1' },
      ]),
    ).toThrow(SchemaValidationError)
  })

  it('self-referential duplicate — throws', () => {
    expect(() =>
      validateEdgeTupleUniqueness([
        { kind: 'follows', from: 'a', to: 'a' },
        { kind: 'follows', from: 'a', to: 'a' },
      ]),
    ).toThrow(SchemaValidationError)
  })

  it('self-referential unique — valid', () => {
    expect(() =>
      validateEdgeTupleUniqueness([
        { kind: 'follows', from: 'a', to: 'a' },
      ]),
    ).not.toThrow()
  })
})

// =============================================================================
// diffCore TESTS
// =============================================================================

describe('diffCore', () => {
  const baseCoreConfig = {
    nodes: {
      admin: { kind: 'user' as const, properties: { email: 'admin@ex.com', name: 'Admin' } },
      defaultSpace: { kind: 'space' as const, properties: { name: 'Default' } },
    },
    edges: [
      { kind: 'owns' as const, from: 'admin' as const, to: 'defaultSpace' as const },
    ],
  }

  it('returns empty diff for identical definitions', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, baseCoreConfig)

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(false)
    expect(diff.breakingReasons).toHaveLength(0)
    expect(diff.warnings).toHaveLength(0)
    expect(diff.nodes.added).toHaveLength(0)
    expect(diff.nodes.removed).toHaveLength(0)
    expect(diff.nodes.modified).toHaveLength(0)
    expect(diff.nodes.kindChanged).toHaveLength(0)
    expect(diff.edges.added).toHaveLength(0)
    expect(diff.edges.removed).toHaveLength(0)
    expect(diff.edges.modified).toHaveLength(0)
  })

  it('detects added node as non-breaking', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, {
      ...baseCoreConfig,
      nodes: {
        ...baseCoreConfig.nodes,
        newUser: { kind: 'user' as const, properties: { email: 'new@ex.com', name: 'New' } },
      },
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.added).toHaveLength(1)
    expect(diff.nodes.added[0]).toEqual({ refKey: 'newUser', kind: 'user' })
  })

  it('detects removed node as breaking', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, {
      nodes: {
        admin: baseCoreConfig.nodes.admin,
        // defaultSpace removed
      },
      edges: [],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(true)
    expect(diff.nodes.removed).toHaveLength(1)
    expect(diff.nodes.removed[0]).toEqual({ refKey: 'defaultSpace', kind: 'space' })
    expect(diff.breakingReasons[0]).toContain('defaultSpace')
  })

  it('detects node kind change as breaking', () => {
    const core1 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
      },
      edges: [],
    })
    const core2 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'space', properties: { name: 'Admin Space' } },
      },
      edges: [],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(true)
    expect(diff.nodes.kindChanged).toHaveLength(1)
    expect(diff.nodes.kindChanged[0]).toEqual({
      refKey: 'admin',
      oldKind: 'user',
      newKind: 'space',
    })
  })

  it('detects node property changes as non-breaking', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, {
      ...baseCoreConfig,
      nodes: {
        ...baseCoreConfig.nodes,
        admin: { kind: 'user' as const, properties: { email: 'newemail@ex.com', name: 'Admin' } },
      },
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.modified).toHaveLength(1)
    expect(diff.nodes.modified[0].refKey).toBe('admin')
    expect(diff.nodes.modified[0].changes).toHaveLength(1)
    expect(diff.nodes.modified[0].changes[0].property).toBe('email')
    expect(diff.nodes.modified[0].changes[0].oldValue).toBe('admin@ex.com')
    expect(diff.nodes.modified[0].changes[0].newValue).toBe('newemail@ex.com')
  })

  it('warns when indexed property changes', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, {
      ...baseCoreConfig,
      nodes: {
        ...baseCoreConfig.nodes,
        admin: { kind: 'user' as const, properties: { email: 'new@ex.com', name: 'Admin' } },
      },
    })

    const diff = diffCore(simpleSchema, core1, core2)

    // 'email' is indexed (btree)
    expect(diff.warnings.length).toBeGreaterThan(0)
    expect(diff.warnings[0]).toContain('email')
    expect(diff.warnings[0]).toContain('btree')

    const emailChange = diff.nodes.modified[0].changes.find((c) => c.property === 'email')
    expect(emailChange?.indexed).toBe(true)
    expect(emailChange?.indexType).toBe('btree')
  })

  it('detects added edge as non-breaking', () => {
    const core1 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
      },
      edges: [],
    })
    const core2 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2024-01-01') } },
      ],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(false)
    expect(diff.edges.added).toHaveLength(1)
    expect(diff.edges.added[0]).toEqual({ kind: 'follows', fromKey: 'admin', toKey: 'other' })
  })

  it('detects removed edge as breaking', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, {
      ...baseCoreConfig,
      edges: [],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(true)
    expect(diff.edges.removed).toHaveLength(1)
    expect(diff.edges.removed[0]).toEqual({ kind: 'owns', fromKey: 'admin', toKey: 'defaultSpace' })
  })

  it('detects edge property changes as non-breaking', () => {
    const date1 = new Date('2024-01-01')
    const date2 = new Date('2025-06-15')

    const core1 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: date1 } },
      ],
    })
    const core2 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
        other: { kind: 'user', properties: { email: 'other@ex.com', name: 'Other' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: date2 } },
      ],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(false)
    expect(diff.edges.modified).toHaveLength(1)
    expect(diff.edges.modified[0].changes).toHaveLength(1)
    expect(diff.edges.modified[0].changes[0].property).toBe('since')
  })

  it('combines multiple changes correctly', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const core2 = defineCore(simpleSchema, {
      nodes: {
        // admin removed (breaking)
        defaultSpace: { kind: 'space', properties: { name: 'Renamed Space' } }, // modified (non-breaking)
        newUser: { kind: 'user', properties: { email: 'new@ex.com', name: 'New' } }, // added
      },
      edges: [],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.breaking).toBe(true)
    expect(diff.nodes.added).toHaveLength(1)
    expect(diff.nodes.removed).toHaveLength(1)
    expect(diff.nodes.modified).toHaveLength(1)
    expect(diff.edges.removed).toHaveLength(1)
    expect(diff.breakingReasons.length).toBeGreaterThanOrEqual(2) // node removed + edge removed
  })

  // --- New tests for CoreSnapshot support, normalization, and bug fixes ---

  it('CoreSnapshot vs CoreSnapshot — identical', () => {
    const core = defineCore(simpleSchema, baseCoreConfig)
    const snapshot = toCoreSnapshot(core)

    const diff = diffCore(simpleSchema, snapshot, snapshot)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.added).toHaveLength(0)
    expect(diff.nodes.removed).toHaveLength(0)
    expect(diff.nodes.modified).toHaveLength(0)
    expect(diff.edges.added).toHaveLength(0)
    expect(diff.edges.removed).toHaveLength(0)
  })

  it('CoreSnapshot vs CoreSnapshot — node added', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const snapshot1 = toCoreSnapshot(core1)

    const snapshot2: CoreSnapshot = {
      nodes: {
        ...snapshot1.nodes,
        newUser: { kind: 'user', properties: { email: 'new@ex.com', name: 'New' } },
      },
      edges: [...snapshot1.edges],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.added).toHaveLength(1)
    expect(diff.nodes.added[0]).toEqual({ refKey: 'newUser', kind: 'user' })
  })

  it('CoreSnapshot vs CoreSnapshot — node removed', () => {
    const core1 = defineCore(simpleSchema, baseCoreConfig)
    const snapshot1 = toCoreSnapshot(core1)

    const snapshot2: CoreSnapshot = {
      nodes: {
        admin: snapshot1.nodes.admin,
        // defaultSpace removed
      },
      edges: [],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    expect(diff.breaking).toBe(true)
    expect(diff.nodes.removed).toHaveLength(1)
    expect(diff.nodes.removed[0].refKey).toBe('defaultSpace')
  })

  it('CoreSnapshot vs CoreSnapshot — property change', () => {
    const core = defineCore(simpleSchema, baseCoreConfig)
    const snapshot1 = toCoreSnapshot(core)

    const snapshot2: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'changed@ex.com', name: 'Admin' } },
        defaultSpace: snapshot1.nodes.defaultSpace,
      },
      edges: [...snapshot1.edges],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    expect(diff.nodes.modified).toHaveLength(1)
    expect(diff.nodes.modified[0].changes[0].property).toBe('email')
    expect(diff.nodes.modified[0].changes[0].oldValue).toBe('admin@ex.com')
    expect(diff.nodes.modified[0].changes[0].newValue).toBe('changed@ex.com')
  })

  it('CoreDefinition vs CoreSnapshot — mixed input', () => {
    const core = defineCore(simpleSchema, baseCoreConfig)
    const snapshot = toCoreSnapshot(core)

    // Same data, different representations — should produce no diff
    const diff = diffCore(simpleSchema, core, snapshot)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.modified).toHaveLength(0)
    expect(diff.edges.modified).toHaveLength(0)
  })

  it('CoreSnapshot vs CoreDefinition — mixed reversed', () => {
    const core = defineCore(simpleSchema, baseCoreConfig)
    const snapshot = toCoreSnapshot(core)

    const diff = diffCore(simpleSchema, snapshot, core)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.modified).toHaveLength(0)
    expect(diff.edges.modified).toHaveLength(0)
  })

  it('CoreDefinition with .default() vs CoreSnapshot — no phantom diff', () => {
    // The critical raw/parsed test: CoreDefinition has raw input (no 'enabled'),
    // CoreSnapshot has parsed output (enabled: true from default).
    // diffCore must normalize both so no phantom diff appears.
    const core = defineCore(zodFeaturesSchema, {
      nodes: {
        myConfig: {
          kind: 'config',
          properties: { label: 'test', tag: 'hello' },
        },
      },
      edges: [],
    })
    const snapshot = toCoreSnapshot(core)

    // snapshot has enabled: true from .default(), tag: 'HELLO' from .transform()
    expect(snapshot.nodes.myConfig.properties.enabled).toBe(true)
    expect(snapshot.nodes.myConfig.properties.tag).toBe('HELLO')

    const diff = diffCore(zodFeaturesSchema, core, snapshot)

    // diffCore normalizes the CoreDefinition through Zod too, so no phantom diff
    expect(diff.nodes.modified).toHaveLength(0)
    expect(diff.breaking).toBe(false)
  })

  it('ref keys with :: — edge correctly identified', () => {
    // Edge key uses JSON.stringify now, not ::, so ref keys containing :: are safe
    const snapshot1: CoreSnapshot = {
      nodes: {
        'ns::admin': { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        'ns::space': { kind: 'space', properties: { name: 'S' } },
      },
      edges: [
        { kind: 'owns', from: 'ns::admin', to: 'ns::space' },
      ],
    }
    const snapshot2: CoreSnapshot = {
      nodes: {
        'ns::admin': { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        'ns::space': { kind: 'space', properties: { name: 'Updated' } },
      },
      edges: [
        { kind: 'owns', from: 'ns::admin', to: 'ns::space' },
      ],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    // Edge should be detected as same (modified properties on node, not removed+added edge)
    expect(diff.edges.removed).toHaveLength(0)
    expect(diff.edges.added).toHaveLength(0)
    expect(diff.nodes.modified).toHaveLength(1)
    expect(diff.nodes.modified[0].refKey).toBe('ns::space')
  })

  it('empty previous → all additions, non-breaking', () => {
    const empty: CoreSnapshot = { nodes: {}, edges: [] }
    const core = defineCore(simpleSchema, baseCoreConfig)
    const snapshot = toCoreSnapshot(core)

    const diff = diffCore(simpleSchema, empty, snapshot)

    expect(diff.breaking).toBe(false)
    expect(diff.nodes.added).toHaveLength(2)
    expect(diff.edges.added).toHaveLength(1)
  })

  it('empty current → all removals, breaking', () => {
    const empty: CoreSnapshot = { nodes: {}, edges: [] }
    const core = defineCore(simpleSchema, baseCoreConfig)
    const snapshot = toCoreSnapshot(core)

    const diff = diffCore(simpleSchema, snapshot, empty)

    expect(diff.breaking).toBe(true)
    expect(diff.nodes.removed).toHaveLength(2)
    expect(diff.edges.removed).toHaveLength(1)
    expect(diff.breakingReasons.length).toBeGreaterThanOrEqual(2)
  })

  it('edge indexed property change → warning', () => {
    const date1 = new Date('2024-01-01')
    const date2 = new Date('2025-01-01')

    const core1 = defineCore(indexedEdgeSchema, {
      nodes: {
        u: { kind: 'user', properties: { name: 'U' } },
        r: { kind: 'resource', properties: { name: 'R' } },
      },
      edges: [
        { kind: 'access', from: 'u', to: 'r', properties: { role: 'admin', grantedAt: date1 } },
      ],
    })
    const core2 = defineCore(indexedEdgeSchema, {
      nodes: {
        u: { kind: 'user', properties: { name: 'U' } },
        r: { kind: 'resource', properties: { name: 'R' } },
      },
      edges: [
        { kind: 'access', from: 'u', to: 'r', properties: { role: 'viewer', grantedAt: date1 } },
      ],
    })

    const diff = diffCore(indexedEdgeSchema, core1, core2)

    expect(diff.edges.modified).toHaveLength(1)
    expect(diff.edges.modified[0].changes[0].property).toBe('role')
    expect(diff.warnings.some((w) => w.includes('role') && w.includes('btree'))).toBe(true)
  })

  it('edge non-indexed property change → no warning', () => {
    const date1 = new Date('2024-01-01')
    const date2 = new Date('2025-01-01')

    const core1 = defineCore(indexedEdgeSchema, {
      nodes: {
        u: { kind: 'user', properties: { name: 'U' } },
        r: { kind: 'resource', properties: { name: 'R' } },
      },
      edges: [
        { kind: 'access', from: 'u', to: 'r', properties: { role: 'admin', grantedAt: date1 } },
      ],
    })
    const core2 = defineCore(indexedEdgeSchema, {
      nodes: {
        u: { kind: 'user', properties: { name: 'U' } },
        r: { kind: 'resource', properties: { name: 'R' } },
      },
      edges: [
        { kind: 'access', from: 'u', to: 'r', properties: { role: 'admin', grantedAt: date2 } },
      ],
    })

    const diff = diffCore(indexedEdgeSchema, core1, core2)

    expect(diff.edges.modified).toHaveLength(1)
    expect(diff.edges.modified[0].changes[0].property).toBe('grantedAt')
    // grantedAt is not indexed — no warning
    expect(diff.warnings).toHaveLength(0)
  })

  it('duplicate edges in previous snapshot → warning (not throw)', () => {
    const snapshot: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        space: { kind: 'space', properties: { name: 'S' } },
      },
      edges: [
        { kind: 'owns', from: 'admin', to: 'space' },
        { kind: 'owns', from: 'admin', to: 'space' },
      ],
    }
    const empty: CoreSnapshot = { nodes: {}, edges: [] }

    // Should not throw — diffCore is a pure function
    const diff = diffCore(simpleSchema, snapshot, empty)

    expect(diff.warnings.some((w) => w.includes('Duplicate edge in previous'))).toBe(true)
    expect(diff.breaking).toBe(true)
  })

  it('duplicate edges in current snapshot → warning (not throw)', () => {
    const empty: CoreSnapshot = { nodes: {}, edges: [] }
    const snapshot: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        space: { kind: 'space', properties: { name: 'S' } },
      },
      edges: [
        { kind: 'owns', from: 'admin', to: 'space' },
        { kind: 'owns', from: 'admin', to: 'space' },
      ],
    }

    const diff = diffCore(simpleSchema, empty, snapshot)

    expect(diff.warnings.some((w) => w.includes('Duplicate edge in current'))).toBe(true)
    expect(diff.breaking).toBe(false) // additions are non-breaking
  })

  it('Date properties: same value, different instances → no false diff', () => {
    const snapshot1: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2024-01-01') } },
      ],
    }
    const snapshot2: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2024-01-01') } },
      ],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    expect(diff.edges.modified).toHaveLength(0)
  })

  it('Date properties: different values → detected', () => {
    const snapshot1: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2024-01-01') } },
      ],
    }
    const snapshot2: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2025-06-15') } },
      ],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    expect(diff.edges.modified).toHaveLength(1)
    expect(diff.edges.modified[0].changes[0].property).toBe('since')
  })

  it('multiple property changes on same node', () => {
    const core1 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'old@ex.com', name: 'OldName' } },
      },
      edges: [],
    })
    const core2 = defineCore(simpleSchema, {
      nodes: {
        admin: { kind: 'user', properties: { email: 'new@ex.com', name: 'NewName' } },
      },
      edges: [],
    })

    const diff = diffCore(simpleSchema, core1, core2)

    expect(diff.nodes.modified).toHaveLength(1)
    expect(diff.nodes.modified[0].changes).toHaveLength(2)
    const properties = diff.nodes.modified[0].changes.map((c) => c.property).sort()
    expect(properties).toEqual(['email', 'name'])

    // email is indexed (btree), name is indexed (fulltext)
    const emailChange = diff.nodes.modified[0].changes.find((c) => c.property === 'email')
    expect(emailChange?.indexed).toBe(true)
    expect(emailChange?.indexType).toBe('btree')
    const nameChange = diff.nodes.modified[0].changes.find((c) => c.property === 'name')
    expect(nameChange?.indexed).toBe(true)
    expect(nameChange?.indexType).toBe('fulltext')
  })

  it('node added to empty → preserves kind in entry', () => {
    const empty: CoreSnapshot = { nodes: {}, edges: [] }
    const snapshot: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
      },
      edges: [],
    }

    const diff = diffCore(simpleSchema, empty, snapshot)

    expect(diff.nodes.added).toHaveLength(1)
    expect(diff.nodes.added[0].kind).toBe('user')
    expect(diff.nodes.added[0].refKey).toBe('admin')
  })

  it('simultaneous edge add + remove', () => {
    const snapshot1: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        space: { kind: 'space', properties: { name: 'S' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'owns', from: 'admin', to: 'space' },
      ],
    }
    const snapshot2: CoreSnapshot = {
      nodes: {
        admin: { kind: 'user', properties: { email: 'a@ex.com', name: 'A' } },
        space: { kind: 'space', properties: { name: 'S' } },
        other: { kind: 'user', properties: { email: 'b@ex.com', name: 'B' } },
      },
      edges: [
        { kind: 'follows', from: 'admin', to: 'other', properties: { since: new Date('2024-01-01') } },
      ],
    }

    const diff = diffCore(simpleSchema, snapshot1, snapshot2)

    expect(diff.edges.removed).toHaveLength(1)
    expect(diff.edges.removed[0].kind).toBe('owns')
    expect(diff.edges.added).toHaveLength(1)
    expect(diff.edges.added[0].kind).toBe('follows')
    expect(diff.breaking).toBe(true) // removal is breaking
  })
})
