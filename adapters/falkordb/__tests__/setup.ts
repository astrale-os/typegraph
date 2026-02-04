/**
 * Global test setup for FalkorDB integration tests.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function startFalkorDB(): Promise<void> {
  console.log('Starting FalkorDB test container...')

  await execAsync('docker-compose -f __tests__/docker-compose.yml up -d', {
    cwd: process.cwd(),
  })

  // Wait for health check
  let attempts = 0
  while (attempts < 30) {
    try {
      const { stdout } = await execAsync(
        'docker-compose -f __tests__/docker-compose.yml ps --filter health=healthy',
        { cwd: process.cwd() }
      )
      if (stdout.includes('healthy')) {
        console.log('FalkorDB is ready!')
        return
      }
    } catch {
      // Ignore errors during health check
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    attempts++
  }

  throw new Error('FalkorDB failed to start within 30 seconds')
}

export async function stopFalkorDB(): Promise<void> {
  console.log('Stopping FalkorDB test container...')
  await execAsync('docker-compose -f __tests__/docker-compose.yml down -v', {
    cwd: process.cwd(),
  })
}

// Global setup/teardown hooks
export async function setup(): Promise<void> {
  await startFalkorDB()
}

export async function teardown(): Promise<void> {
  await stopFalkorDB()
}
