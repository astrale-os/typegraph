/**
 * Unit tests for result transformation.
 */

import { describe, it, expect } from 'vitest'
import { convertValue, isFalkorNode, isFalkorRelationship } from '../src/transform'

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
