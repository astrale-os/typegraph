/**
 * Global test setup for FalkorDB integration tests.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

let weStartedContainer = false

async function isContainerRunning(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('docker-compose ps --format json', {
      cwd: process.cwd(),
    })
    if (!stdout.trim()) return false
    return stdout.includes('falkordb-test') && stdout.includes('running')
  } catch {
    return false
  }
}

async function waitForHealthy(maxAttempts = 30): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { stdout } = await execAsync('docker-compose ps', { cwd: process.cwd() })
      if (stdout.includes('(healthy)')) {
        return
      }
    } catch {
      // Ignore errors during health check
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('FalkorDB failed to become healthy within timeout')
}

export async function startFalkorDB(): Promise<void> {
  const alreadyRunning = await isContainerRunning()

  if (alreadyRunning) {
    console.log('FalkorDB container already running, reusing...')
    weStartedContainer = false
    return
  }

  console.log('Starting FalkorDB test container...')
  weStartedContainer = true

  await execAsync('docker-compose up -d', { cwd: process.cwd() })
  await waitForHealthy()

  console.log('FalkorDB is ready!')
}

export async function stopFalkorDB(): Promise<void> {
  if (!weStartedContainer) {
    console.log('FalkorDB was already running before tests, leaving it up.')
    return
  }

  console.log('Stopping FalkorDB test container...')
  await execAsync('docker-compose down -v', { cwd: process.cwd() })
}

// Global setup/teardown hooks
export async function setup(): Promise<void> {
  await startFalkorDB()
}

export async function teardown(): Promise<void> {
  await stopFalkorDB()
}
