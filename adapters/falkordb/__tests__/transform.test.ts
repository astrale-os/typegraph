/**
 * Unit tests for result transformation.
 */

import { describe, it, expect } from 'vitest'

import {
  convertValue,
  isFalkorNode,
  isFalkorRelationship,
  serializeProperties,
} from '../src/transform'

describe('Result Transformation', () => {
  it('should detect FalkorDB nodes', () => {
    const node = {
      id: 1,
      labels: ['User'],
      properties: { name: 'Alice' },
    }
    expect(isFalkorNode(node)).toBe(true)
  })

  it('should detect FalkorDB relationships', () => {
    const rel = {
      id: 1,
      relationshipType: 'FOLLOWS',
      properties: { since: '2024-01-01' },
    }
    expect(isFalkorRelationship(rel)).toBe(true)
  })

  it('should transform nested structures', () => {
    const input = {
      user: {
        id: 1,
        labels: ['User'],
        properties: { name: 'Alice', age: 30 },
      },
      posts: [
        {
          id: 2,
          labels: ['Post'],
          properties: { title: 'Hello' },
        },
      ],
    }

    const result = convertValue(input)
    expect(result).toEqual({
      user: { id: 1, name: 'Alice', age: 30 },
      posts: [{ id: 2, title: 'Hello' }],
    })
  })

  it('should handle circular references', () => {
    const obj: Record<string, unknown> = { name: 'Alice' }
    obj.self = obj // Circular reference

    const result = convertValue(obj)
    expect(result).toHaveProperty('name', 'Alice')
    expect(result).toHaveProperty('self')
    expect((result as Record<string, unknown>).self).toBe(result) // Same reference
  })

  it('should preserve custom IDs', () => {
    const node = {
      id: 123,
      labels: ['User'],
      properties: { id: 'user_abc', name: 'Alice' },
    }

    const result = convertValue(node)
    expect(result).toEqual({ id: 'user_abc', name: 'Alice' })
  })

  it('should handle primitives', () => {
    expect(convertValue(null)).toBe(null)
    expect(convertValue(undefined)).toBe(undefined)
    expect(convertValue(42)).toBe(42)
    expect(convertValue('hello')).toBe('hello')
    expect(convertValue(true)).toBe(true)
  })

  it('should handle arrays', () => {
    const input = [
      { id: 1, labels: ['User'], properties: { name: 'Alice' } },
      { id: 2, labels: ['User'], properties: { name: 'Bob' } },
    ]

    const result = convertValue(input)
    expect(result).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ])
  })
})

describe('Complex Property Serde', () => {
  it('should leave primitives untouched', () => {
    const props = { name: 'Alice', age: 30, active: true }
    expect(serializeProperties(props)).toEqual(props)
  })

  it('should leave flat arrays of primitives untouched', () => {
    const props = { tags: ['admin', 'user'], scores: [1, 2, 3] }
    expect(serializeProperties(props)).toEqual(props)
  })

  it('should serialize plain objects', () => {
    const props = { config: { theme: 'dark', lang: 'en' } }
    const serialized = serializeProperties(props)
    expect(typeof serialized.config).toBe('string')
    expect(serialized.config).toContain('json:')
  })

  it('should serialize arrays of objects', () => {
    const props = { claims: [{ type: 'role', value: 'admin' }] }
    const serialized = serializeProperties(props)
    expect(typeof serialized.claims).toBe('string')
  })

  it('should round-trip plain objects through serialize → convertValue', () => {
    const original = {
      name: 'test',
      publicKey: { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' },
      requiredClaims: [
        { type: 'role', value: 'admin' },
        { type: 'org', value: 'acme' },
      ],
      simple: 42,
      tags: ['a', 'b'],
    }

    const serialized = serializeProperties(original)
    expect(serialized.name).toBe('test')
    expect(serialized.simple).toBe(42)
    expect(serialized.tags).toEqual(['a', 'b'])
    expect(typeof serialized.publicKey).toBe('string')
    expect(typeof serialized.requiredClaims).toBe('string')

    const deserialized: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(serialized)) {
      deserialized[k] = convertValue(v)
    }
    expect(deserialized).toEqual(original)
  })

  it('should round-trip nested objects preserving structure', () => {
    const original = {
      meta: { nested: { deep: { value: [1, { x: 2 }] } } },
    }
    const serialized = serializeProperties(original)
    const restored = convertValue(serialized.meta)
    expect(restored).toEqual(original.meta)
  })

  it('should not double-serialize already-serialized values', () => {
    const props = { config: { a: 1 } }
    const once = serializeProperties(props)
    const twice = serializeProperties(once)
    expect(twice.config).toBe(once.config)
  })

  it('should handle null and undefined values', () => {
    const props = { a: null, b: undefined, c: 'ok' }
    const serialized = serializeProperties(props)
    expect(serialized.a).toBe(null)
    expect(serialized.b).toBe(undefined)
    expect(serialized.c).toBe('ok')
  })
})
