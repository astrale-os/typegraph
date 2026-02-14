import { describe, it, expect } from 'vitest'
import { generate } from '../src/generate.js'
import { load } from '../src/loader.js'
import type { SchemaIR, ValueTypeDef } from '../src/model.js'
import { compileAndGenerate, compileToModel } from './helpers.js'

// ─── Hand-crafted IR with value types ────────────────────────
// Synthetic IR for isolated codegen testing (no compiler dependency).

function makeIR(overrides?: Partial<SchemaIR>): SchemaIR {
  return {
    version: '1.0',
    meta: { generated_at: '', source_hash: '' },
    extensions: [],
    builtin_scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp'],
    type_aliases: [],
    value_types: [],
    classes: [],
    ...overrides,
  }
}

const coordsType: ValueTypeDef = {
  name: 'Coordinates',
  fields: [
    { name: 'lat', type: { kind: 'Scalar', name: 'Float' }, nullable: false, default: null },
    { name: 'lng', type: { kind: 'Scalar', name: 'Float' }, nullable: false, default: null },
  ],
}

const addressType: ValueTypeDef = {
  name: 'Address',
  fields: [
    { name: 'street', type: { kind: 'Scalar', name: 'String' }, nullable: false, default: null },
    { name: 'city', type: { kind: 'Scalar', name: 'String' }, nullable: false, default: null },
    { name: 'zip', type: { kind: 'Scalar', name: 'String' }, nullable: true, default: null },
  ],
}

const tagsType: ValueTypeDef = {
  name: 'TagSet',
  fields: [
    {
      name: 'tags',
      type: { kind: 'List', element: { kind: 'Scalar', name: 'String' } },
      nullable: false,
      default: null,
    },
  ],
}

const emptyType: ValueTypeDef = {
  name: 'EmptyType',
  fields: [],
}

const nestedType: ValueTypeDef = {
  name: 'Location',
  fields: [
    {
      name: 'coords',
      type: { kind: 'ValueType', name: 'Coordinates' },
      nullable: false,
      default: null,
    },
    {
      name: 'label',
      type: { kind: 'Scalar', name: 'String' },
      nullable: true,
      default: { kind: 'StringLiteral', value: 'unnamed' },
    },
  ],
}

// ─── Model Tests ────────────────────────────────────────────

describe('Model — Value Types', () => {
  it('loads value types into GraphModel', () => {
    const model = load([makeIR({ value_types: [coordsType, addressType] })])
    expect(model.valueTypes.size).toBe(2)
    expect(model.valueTypes.get('Coordinates')).toBeDefined()
    expect(model.valueTypes.get('Address')).toBeDefined()
  })

  it('loads value type fields correctly', () => {
    const model = load([makeIR({ value_types: [coordsType] })])
    const coords = model.valueTypes.get('Coordinates')!
    expect(coords.fields).toHaveLength(2)
    expect(coords.fields[0].name).toBe('lat')
    expect(coords.fields[1].name).toBe('lng')
  })

  it('handles empty value types', () => {
    const model = load([makeIR({ value_types: [emptyType] })])
    const empty = model.valueTypes.get('EmptyType')!
    expect(empty.fields).toHaveLength(0)
  })
})

// ─── Interface Emission Tests ───────────────────────────────

describe('Interfaces — Value Types', () => {
  it('emits value type as TS interface', () => {
    const { source } = generate([makeIR({ value_types: [coordsType] })])
    expect(source).toContain('export interface Coordinates {')
    expect(source).toContain('lat: number')
    expect(source).toContain('lng: number')
  })

  it('emits nullable field with optional + null union', () => {
    const { source } = generate([makeIR({ value_types: [addressType] })])
    expect(source).toContain('zip?: string | null')
  })

  it('emits list field as array type', () => {
    const { source } = generate([makeIR({ value_types: [tagsType] })])
    expect(source).toContain('tags: string[]')
  })

  it('emits empty value type as empty interface', () => {
    const { source } = generate([makeIR({ value_types: [emptyType] })])
    expect(source).toContain('export interface EmptyType {}')
  })

  it('emits nested value type reference', () => {
    const { source } = generate([makeIR({ value_types: [coordsType, nestedType] })])
    expect(source).toContain('coords: Coordinates')
  })
})

// ─── Validator Emission Tests ───────────────────────────────

describe('Validators — Value Types', () => {
  it('emits z.object validator for value type', () => {
    const { source } = generate([makeIR({ value_types: [coordsType] })])
    expect(source).toContain('Coordinates: z.object({')
    expect(source).toContain('lat: z.number()')
    expect(source).toContain('lng: z.number()')
  })

  it('emits nullable field with .nullable().optional()', () => {
    const { source } = generate([makeIR({ value_types: [addressType] })])
    expect(source).toContain('zip: z.string().nullable().optional()')
  })

  it('emits default value in validator', () => {
    const { source } = generate([makeIR({ value_types: [nestedType, coordsType] })])
    expect(source).toContain("label: z.string().nullable().optional().default('unnamed')")
  })

  it('references nested value type validator', () => {
    const { source } = generate([makeIR({ value_types: [coordsType, nestedType] })])
    expect(source).toContain('coords: validators.Coordinates')
  })
})

// ─── Schema Value Emission Tests ────────────────────────────

describe('Schema Value — Value Types', () => {
  it('emits valueTypes section in schema', () => {
    const { source } = generate([makeIR({ value_types: [coordsType] })])
    expect(source).toContain('valueTypes: {')
    expect(source).toContain("Coordinates: { fields: ['lat', 'lng'] }")
  })

  it('includes multiple value types', () => {
    const { source } = generate([makeIR({ value_types: [coordsType, addressType] })])
    expect(source).toContain("Coordinates: { fields: ['lat', 'lng'] }")
    expect(source).toContain("Address: { fields: ['street', 'city', 'zip'] }")
  })

  it('omits valueTypes section when none defined', () => {
    const { source } = generate([makeIR({ value_types: [] })])
    expect(source).not.toContain('valueTypes:')
  })
})

// ─── Method Integration Tests ───────────────────────────────

describe('Method + Value Type Integration', () => {
  it('method with value type param emits correct TS', () => {
    const { source } = generate([
      makeIR({
        value_types: [coordsType],
        classes: [
          {
            type: 'node',
            name: 'Place',
            abstract: false,
            implements: [],
            attributes: [
              {
                name: 'name',
                type: { kind: 'Scalar', name: 'String' },
                nullable: false,
                default: null,
                modifiers: {},
              },
            ],
            methods: [
              {
                name: 'setLocation',
                params: [
                  {
                    name: 'coords',
                    type: { kind: 'ValueType', name: 'Coordinates' },
                    default: null,
                  },
                ],
                return_type: { kind: 'Scalar', name: 'Boolean' },
                return_nullable: false,
              },
            ],
          },
        ],
      }),
    ])
    expect(source).toContain('coords: Coordinates')
  })

  it('method with value type return emits correct TS', () => {
    const { source } = generate([
      makeIR({
        value_types: [coordsType],
        classes: [
          {
            type: 'node',
            name: 'Place',
            abstract: false,
            implements: [],
            attributes: [],
            methods: [
              {
                name: 'getLocation',
                params: [],
                return_type: { kind: 'ValueType', name: 'Coordinates' },
                return_nullable: false,
              },
            ],
          },
        ],
      }),
    ])
    expect(source).toContain('Coordinates')
  })
})

// ─── Integration Tests (KRL → Compiler → Codegen) ──────────

describe('Integration — KRL → Codegen Value Types', () => {
  it('compiles and generates value type from KRL', () => {
    const { source } = compileAndGenerate(`
      type Coords = { lat: Float, lng: Float }
    `)
    expect(source).toContain('export interface Coords {')
    expect(source).toContain('lat: number')
    expect(source).toContain('lng: number')
  })

  it('generates method with value type param from KRL', () => {
    const { source } = compileAndGenerate(`
      type Coords = { lat: Float, lng: Float }
      class Map {
        fn setCenter(coords: Coords): Boolean
      }
    `)
    expect(source).toContain('export interface Coords {')
    expect(source).toContain('coords: Coords')
  })

  it('generates method with value type return from KRL', () => {
    const { source } = compileAndGenerate(`
      type Coords = { lat: Float, lng: Float }
      class Place {
        name: String
        fn location(): Coords
      }
    `)
    expect(source).toContain('Coords')
  })

  it('generates nested value types from KRL', () => {
    const { source } = compileAndGenerate(`
      type Point = { x: Float, y: Float }
      type Rect = { topLeft: Point, bottomRight: Point }
    `)
    expect(source).toContain('export interface Point {')
    expect(source).toContain('export interface Rect {')
    expect(source).toContain('topLeft: Point')
    expect(source).toContain('bottomRight: Point')
  })

  it('loads value types into model from KRL', () => {
    const model = compileToModel(`
      type Coords = { lat: Float, lng: Float }
      type Config = { retries: Int = 3 }
    `)
    expect(model.valueTypes.size).toBe(2)
    expect(model.valueTypes.get('Coords')).toBeDefined()
    expect(model.valueTypes.get('Config')).toBeDefined()
  })

  it('generates value type validators from KRL', () => {
    const { source } = compileAndGenerate(`
      type Coords = { lat: Float, lng: Float }
    `)
    expect(source).toContain('Coords: z.object({')
  })

  it('generates schema valueTypes metadata from KRL', () => {
    const { source } = compileAndGenerate(`
      type Coords = { lat: Float, lng: Float }
    `)
    expect(source).toContain('valueTypes: {')
    expect(source).toContain("Coords: { fields: ['lat', 'lng'] }")
  })
})
