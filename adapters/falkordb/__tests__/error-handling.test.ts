/**
 * Error handling tests.
 */

import { describe, it, expect } from 'vitest'

import { FalkorDBAdapter, deleteGraph } from '../src'

describe('Error Handling', () => {
  it('should provide helpful error for missing graphName', async () => {
    const adapter = new FalkorDBAdapter({ host: 'localhost', port: 6380 } as any)
    await expect(adapter.connect()).rejects.toThrow(/graphName is required/)
  })

  it('should reject graphName with injection attempt', async () => {
    const adapter = new FalkorDBAdapter({
      host: 'localhost',
      port: 6380,
      graphName: "test'); DROP GRAPH x; --",
    })
    await expect(adapter.connect()).rejects.toThrow(/invalid graphName/)
  })

  it('should reject graphName with special characters via deleteGraph', async () => {
    await expect(
      deleteGraph({
        host: 'localhost',
        port: 6380,
        graphName: 'test; MATCH (n) DELETE n',
      }),
    ).rejects.toThrow(/invalid graphName/)
  })

  it('should provide helpful error for connection failure', async () => {
    const adapter = new FalkorDBAdapter({
      host: 'nonexistent-host-12345',
      port: 6380,
      graphName: 'test',
      retry: { maxRetries: 1, delayMs: 100 },
    })
    await expect(adapter.connect()).rejects.toThrow(/Failed to connect to FalkorDB/)
  })

  it('should handle invalid port gracefully', async () => {
    const adapter = new FalkorDBAdapter({
      host: 'localhost',
      port: 99999,
      graphName: 'test',
    })
    await expect(adapter.connect()).rejects.toThrow(/invalid port/)
  })

  it('should handle negative timeout', async () => {
    const adapter = new FalkorDBAdapter({
      host: 'localhost',
      port: 6380,
      graphName: 'test',
      timeout: -1,
    })
    await expect(adapter.connect()).rejects.toThrow(/timeout must be positive/)
  })
})
