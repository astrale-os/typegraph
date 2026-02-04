/**
 * Error handling tests.
 */

import { describe, it, expect } from 'vitest'
import { createFalkorDBGraph } from '../src'
import { defineSchema, node } from '@astrale/typegraph'
import { z } from 'zod'

describe('Error Handling', () => {
  const schema = defineSchema({
    nodes: { user: node({ properties: { name: z.string() } }) },
    edges: {},
  })

  it('should provide helpful error for missing graphName', async () => {
    await expect(
      createFalkorDBGraph(schema, { host: 'localhost', port: 6380 } as any)
    ).rejects.toThrow(/graphName is required/)
  })

  it('should provide helpful error for connection failure', async () => {
    await expect(
      createFalkorDBGraph(schema, {
        host: 'nonexistent-host-12345',
        port: 6380,
        graphName: 'test',
        timeout: 1000,
        retry: { maxRetries: 1, delayMs: 100 },
      })
    ).rejects.toThrow(/Failed to connect to FalkorDB/)
  })

  it('should handle invalid port gracefully', async () => {
    await expect(
      createFalkorDBGraph(schema, {
        host: 'localhost',
        port: 99999,
        graphName: 'test',
      })
    ).rejects.toThrow(/invalid port/)
  })

  it('should handle negative timeout', async () => {
    await expect(
      createFalkorDBGraph(schema, {
        host: 'localhost',
        port: 6380,
        graphName: 'test',
        timeout: -1,
      })
    ).rejects.toThrow(/timeout must be positive/)
  })
})
