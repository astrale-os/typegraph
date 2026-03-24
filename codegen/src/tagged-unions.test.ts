// src/tagged-unions.test.ts
// ============================================================
// Codegen tests for tagged union declarations.
// ============================================================

import { describe, it, expect } from 'vitest'

import type { SchemaIR } from './model'

import { generate } from './generate'
import { load } from './loader'

// ─── Helpers ────────────────────────────────────────────────

function makeIR(overrides: Partial<SchemaIR> = {}): SchemaIR {
  return {
    version: '1.0',
    meta: { generated_at: '', source_hash: '' },
    extensions: [],
    builtin_scalars: ['String', 'Int', 'Float', 'Boolean'],
    type_aliases: [],
    value_types: [],
    tagged_unions: [],
    data_types: [],
    classes: [],
    ...overrides,
  }
}

// ─── Loader Tests ───────────────────────────────────────────

describe('load — Tagged Unions', () => {
  it('loads tagged unions into the model', () => {
    const ir = makeIR({
      tagged_unions: [
        {
          name: 'PublicKey',
          variants: [
            {
              tag: 'jwk',
              fields: [
                {
                  name: 'key',
                  type: { kind: 'Scalar', name: 'String' },
                  nullable: false,
                  default: null,
                },
              ],
            },
            {
              tag: 'jwksUri',
              fields: [
                {
                  name: 'uri',
                  type: { kind: 'Scalar', name: 'String' },
                  nullable: false,
                  default: null,
                },
              ],
            },
          ],
        },
      ],
    })
    const model = load([ir])
    expect(model.taggedUnions.has('PublicKey')).toBe(true)
    expect(model.taggedUnions.get('PublicKey')!.variants).toHaveLength(2)
  })

  it('deduplicates identical tagged union definitions', () => {
    const ir = makeIR({
      tagged_unions: [
        {
          name: 'PK',
          variants: [
            {
              tag: 'a',
              fields: [
                {
                  name: 'x',
                  type: { kind: 'Scalar', name: 'Int' },
                  nullable: false,
                  default: null,
                },
              ],
            },
            {
              tag: 'b',
              fields: [
                {
                  name: 'y',
                  type: { kind: 'Scalar', name: 'String' },
                  nullable: false,
                  default: null,
                },
              ],
            },
          ],
        },
      ],
    })
    const model = load([ir, ir])
    expect(model.taggedUnions.size).toBe(1)
  })

  it('throws on conflicting tagged union definitions in strict mode', () => {
    const ir1 = makeIR({
      tagged_unions: [
        {
          name: 'PK',
          variants: [
            {
              tag: 'a',
              fields: [
                {
                  name: 'x',
                  type: { kind: 'Scalar', name: 'Int' },
                  nullable: false,
                  default: null,
                },
              ],
            },
            { tag: 'b', fields: [] },
          ],
        },
      ],
    })
    const ir2 = makeIR({
      tagged_unions: [
        {
          name: 'PK',
          variants: [
            {
              tag: 'c',
              fields: [
                {
                  name: 'z',
                  type: { kind: 'Scalar', name: 'String' },
                  nullable: false,
                  default: null,
                },
              ],
            },
            { tag: 'd', fields: [] },
          ],
        },
      ],
    })
    expect(() => load([ir1, ir2])).toThrow('Conflicting')
  })
})

// ─── Generate Tests ─────────────────────────────────────────

describe('generate — Tagged Unions', () => {
  const ir = makeIR({
    tagged_unions: [
      {
        name: 'PublicKey',
        variants: [
          {
            tag: 'jwk',
            fields: [
              {
                name: 'key',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
          {
            tag: 'jwksUri',
            fields: [
              {
                name: 'uri',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
        ],
      },
    ],
  })

  it('emits discriminated union type', () => {
    const { source } = generate([ir])
    expect(source).toContain('export type PublicKey =')
    expect(source).toContain("kind: 'jwk'")
    expect(source).toContain('key: string')
    expect(source).toContain("kind: 'jwksUri'")
    expect(source).toContain('uri: string')
  })

  it('emits z.discriminatedUnion validator', () => {
    const { source } = generate([ir])
    expect(source).toContain("PublicKey: z.discriminatedUnion('kind', [")
    expect(source).toContain("kind: z.literal('jwk')")
    expect(source).toContain("kind: z.literal('jwksUri')")
  })

  it('emits tagged unions section in schema value', () => {
    const { source } = generate([ir])
    expect(source).toContain('taggedUnions: {')
    expect(source).toContain("PublicKey: { variants: ['jwk', 'jwksUri'] }")
  })
})

describe('generate — Tagged Union with nullable and default fields', () => {
  const ir = makeIR({
    tagged_unions: [
      {
        name: 'Config',
        variants: [
          {
            tag: 'basic',
            fields: [
              {
                name: 'retries',
                type: { kind: 'Scalar', name: 'Int' },
                nullable: false,
                default: { kind: 'NumberLiteral', value: 3 },
              },
            ],
          },
          {
            tag: 'advanced',
            fields: [
              {
                name: 'timeout',
                type: { kind: 'Scalar', name: 'Int' },
                nullable: true,
                default: null,
              },
            ],
          },
        ],
      },
    ],
  })

  it('emits nullable fields with ? and | null', () => {
    const { source } = generate([ir])
    expect(source).toContain('timeout?: number | null')
  })

  it('emits default values in Zod schema', () => {
    const { source } = generate([ir])
    expect(source).toContain('.default(3)')
  })

  it('emits nullable in Zod schema', () => {
    const { source } = generate([ir])
    expect(source).toContain('.nullable().optional()')
  })
})

describe('generate — Tagged Union as attribute type', () => {
  const ir = makeIR({
    tagged_unions: [
      {
        name: 'PublicKey',
        variants: [
          {
            tag: 'jwk',
            fields: [
              {
                name: 'key',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
          {
            tag: 'jwksUri',
            fields: [
              {
                name: 'uri',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
        ],
      },
    ],
    classes: [
      {
        type: 'node' as const,
        name: 'Identity',
        abstract: false,
        implements: [],
        attributes: [
          {
            name: 'publicKey',
            type: { kind: 'TaggedUnion' as const, name: 'PublicKey' },
            nullable: false,
            default: null,
            modifiers: {},
          },
        ],
        methods: [],
      },
    ],
  })

  it('resolves TaggedUnion TypeRef to the type name in interface', () => {
    const { source } = generate([ir])
    expect(source).toContain('publicKey: PublicKey')
  })

  it('resolves TaggedUnion TypeRef to validators.Name in Zod', () => {
    const { source } = generate([ir])
    expect(source).toContain('publicKey: validators.PublicKey')
  })
})

describe('generate — Multiple tagged unions', () => {
  const ir = makeIR({
    tagged_unions: [
      {
        name: 'PublicKey',
        variants: [
          {
            tag: 'jwk',
            fields: [
              {
                name: 'key',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
          {
            tag: 'jwksUri',
            fields: [
              {
                name: 'uri',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
        ],
      },
      {
        name: 'ClaimConstraint',
        variants: [
          {
            tag: 'eq',
            fields: [
              {
                name: 'field',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
              {
                name: 'value',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
          {
            tag: 'contains',
            fields: [
              {
                name: 'field',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
              {
                name: 'value',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
          {
            tag: 'exists',
            fields: [
              {
                name: 'field',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
              },
            ],
          },
        ],
      },
    ],
  })

  it('emits both tagged union types', () => {
    const { source } = generate([ir])
    expect(source).toContain('export type PublicKey =')
    expect(source).toContain('export type ClaimConstraint =')
  })

  it('emits both tagged union validators', () => {
    const { source } = generate([ir])
    expect(source).toContain("PublicKey: z.discriminatedUnion('kind', [")
    expect(source).toContain("ClaimConstraint: z.discriminatedUnion('kind', [")
  })

  it('emits both in schema value', () => {
    const { source } = generate([ir])
    expect(source).toContain("PublicKey: { variants: ['jwk', 'jwksUri'] }")
    expect(source).toContain("ClaimConstraint: { variants: ['eq', 'contains', 'exists'] }")
  })
})
