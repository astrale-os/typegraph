/**
 * Query Execution Tests
 *
 * Tests for the execute() methods in query builders.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { testSchema } from './fixtures/test-schema'
import { createGraph, type QueryExecutor, CardinalityError, ExecutionError } from '../../src'

describe('Query Execution', () => {
  let mockExecutor: QueryExecutor

  beforeEach(() => {
    mockExecutor = {
      run: vi.fn(),
    }
  })

  describe('CollectionBuilder.execute()', () => {
    it('should execute and return array of results', async () => {
      const mockResults = [
        { n0: { properties: { id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' } } },
        { n0: { properties: { id: 'u2', email: 'b@test.com', name: 'Bob', status: 'active' } } },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').execute()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' })
      expect(result[1]).toEqual({ id: 'u2', email: 'b@test.com', name: 'Bob', status: 'active' })
    })

    it('should return empty array when no results', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').execute()

      expect(result).toHaveLength(0)
    })

    it('should throw ExecutionError when no executor provided', async () => {
      const graph = createGraph(testSchema, {})

      await expect(graph.node('user').execute()).rejects.toThrow(ExecutionError)
    })

    it('should convert Neo4j Integer types', async () => {
      const mockResults = [
        {
          n0: {
            properties: {
              id: 'p1',
              title: 'Test Post',
              viewCount: { toNumber: () => 42 }, // Neo4j Integer
            },
          },
        },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('post').execute()

      expect(result[0]!.viewCount).toBe(42)
      expect(typeof result[0]!.viewCount).toBe('number')
    })

    it('should convert Neo4j DateTime types', async () => {
      const testDate = new Date('2024-01-15T10:30:00Z')
      const mockResults = [
        {
          n0: {
            properties: {
              id: 'u1',
              email: 'test@test.com',
              name: 'Test',
              status: 'active',
              createdAt: { toStandardDate: () => testDate }, // Neo4j DateTime
            },
          },
        },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').execute()

      expect(result[0]!.createdAt).toEqual(testDate)
      expect(result[0]!.createdAt).toBeInstanceOf(Date)
    })

    it('should handle plain objects (not Neo4j nodes)', async () => {
      const mockResults = [
        { n0: { id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' } },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').execute()

      expect(result[0]).toEqual({ id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' })
    })
  })

  describe('CollectionBuilder.count()', () => {
    it('should return count from query', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([{ count: 5 }])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const count = await graph.node('user').count()

      expect(count).toBe(5)
    })

    it('should handle Neo4j Integer count', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([{ count: { toNumber: () => 10 } }])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const count = await graph.node('user').count()

      expect(count).toBe(10)
    })

    it('should return 0 when no results', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const count = await graph.node('user').count()

      expect(count).toBe(0)
    })
  })

  describe('SingleNodeBuilder.execute()', () => {
    it('should return single result', async () => {
      const mockResults = [
        { n0: { properties: { id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' } } },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').byId('u1').execute()

      expect(result).toEqual({ id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' })
    })

    it('should throw CardinalityError when no results', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })

      await expect(graph.node('user').byId('nonexistent').execute()).rejects.toThrow(
        CardinalityError,
      )
    })

    it('should throw CardinalityError when multiple results', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([
        { n0: { properties: { id: 'u1' } } },
        { n0: { properties: { id: 'u2' } } },
      ])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })

      const error = await graph
        .node('user')
        .byId('u1')
        .execute()
        .catch((e) => e)
      expect(error).toBeInstanceOf(CardinalityError)
      expect(error.expected).toBe('one')
      expect(error.actual).toBe(2)
    })
  })

  describe('SingleNodeBuilder.executeOrNull()', () => {
    it('should return result when found', async () => {
      const mockResults = [
        { n0: { properties: { id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' } } },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').byId('u1').executeOrNull()

      expect(result).toEqual({ id: 'u1', email: 'a@test.com', name: 'Alice', status: 'active' })
    })

    it('should return null when not found', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('user').byId('nonexistent').executeOrNull()

      expect(result).toBeNull()
    })
  })

  describe('SingleNodeBuilder.exists()', () => {
    it('should return true when node exists', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([{ n0: { properties: { id: 'u1' } } }])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const exists = await graph.node('user').byId('u1').exists()

      expect(exists).toBe(true)
    })

    it('should return false when node does not exist', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const exists = await graph.node('user').byId('nonexistent').exists()

      expect(exists).toBe(false)
    })
  })

  describe('OptionalNodeBuilder.execute()', () => {
    it('should return result when found', async () => {
      const mockResults = [{ n0: { properties: { id: 'c1', name: 'Tech' } } }]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('category').byId('c1').parent().execute()

      expect(result).toEqual({ id: 'c1', name: 'Tech' })
    })

    it('should return null when not found', async () => {
      vi.mocked(mockExecutor.run).mockResolvedValue([])

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph.node('category').byId('root').parent().execute()

      expect(result).toBeNull()
    })
  })

  describe('ReturningBuilder.execute()', () => {
    it('should return multiple aliased results', async () => {
      const mockResults = [
        {
          author: { properties: { id: 'u1', name: 'Alice' } },
          post: { properties: { id: 'p1', title: 'Hello' } },
        },
        {
          author: { properties: { id: 'u1', name: 'Alice' } },
          post: { properties: { id: 'p2', title: 'World' } },
        },
      ]

      vi.mocked(mockExecutor.run).mockResolvedValue(mockResults)

      const graph = createGraph(testSchema, { queryExecutor: mockExecutor })
      const result = await graph
        .node('user')
        .as('author')
        .to('authored')
        .as('post')
        .returning('author', 'post')
        .execute()

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        author: { id: 'u1', name: 'Alice' },
        post: { id: 'p1', title: 'Hello' },
      })
    })

    it('should throw ExecutionError when no executor', async () => {
      const graph = createGraph(testSchema, {})

      await expect(graph.node('user').as('u').returning('u').execute()).rejects.toThrow(
        ExecutionError,
      )
    })
  })
})
