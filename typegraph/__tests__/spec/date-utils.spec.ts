/**
 * Date Utilities Tests
 *
 * Unit tests for isDateSchema() and deserializeDateFields().
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { isDateSchema, deserializeDateFields } from '../../src/utils/dates'
import { testSchema } from './fixtures/test-schema'

describe('isDateSchema', () => {
  it('should detect z.date()', () => {
    expect(isDateSchema(z.date())).toBe(true)
  })

  it('should detect z.date().optional()', () => {
    expect(isDateSchema(z.date().optional())).toBe(true)
  })

  it('should detect z.date().default()', () => {
    expect(isDateSchema(z.date().default(() => new Date()))).toBe(true)
  })

  it('should reject z.string()', () => {
    expect(isDateSchema(z.string())).toBe(false)
  })

  it('should reject z.number()', () => {
    expect(isDateSchema(z.number())).toBe(false)
  })

  it('should reject z.string().optional()', () => {
    expect(isDateSchema(z.string().optional())).toBe(false)
  })
})

describe('deserializeDateFields', () => {
  it('should convert ISO string to Date for date-typed fields', () => {
    const iso = '2024-01-15T10:30:00.000Z'
    const result = deserializeDateFields(testSchema, 'user', {
      id: 'u1',
      name: 'Alice',
      email: 'a@test.com',
      status: 'active',
      createdAt: iso,
    })

    expect(result.createdAt).toBeInstanceOf(Date)
    expect((result.createdAt as Date).toISOString()).toBe(iso)
    // Non-date fields untouched
    expect(result.name).toBe('Alice')
    expect(result.email).toBe('a@test.com')
  })

  it('should leave existing Date objects untouched (idempotency)', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    const result = deserializeDateFields(testSchema, 'user', {
      id: 'u1',
      name: 'Alice',
      email: 'a@test.com',
      status: 'active',
      createdAt: date,
    })

    // Date is not a string → not modified
    expect(result.createdAt).toBe(date)
  })

  it('should handle optional date fields', () => {
    const iso = '2024-06-01T00:00:00.000Z'
    const result = deserializeDateFields(testSchema, 'post', {
      id: 'p1',
      title: 'Test',
      content: 'Body',
      publishedAt: iso,
    })

    expect(result.publishedAt).toBeInstanceOf(Date)
  })

  it('should handle missing optional date fields', () => {
    const result = deserializeDateFields(testSchema, 'post', {
      id: 'p1',
      title: 'Test',
      content: 'Body',
    })

    expect(result.publishedAt).toBeUndefined()
  })

  it('should return data unchanged for unknown labels', () => {
    const data = { foo: '2024-01-01T00:00:00Z' }
    const result = deserializeDateFields(testSchema, 'nonexistent', data)

    expect(result).toEqual(data)
  })

  it('should not mutate the original data object', () => {
    const iso = '2024-01-15T10:30:00.000Z'
    const original = {
      id: 'u1',
      name: 'Alice',
      email: 'a@test.com',
      status: 'active',
      createdAt: iso,
    }
    deserializeDateFields(testSchema, 'user', original)

    // Original should still have the string
    expect(original.createdAt).toBe(iso)
  })
})
