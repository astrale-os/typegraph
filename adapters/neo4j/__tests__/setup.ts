/**
 * Global test setup for Neo4j integration tests.
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
    // Check if neo4j-test service is running
    return stdout.includes('neo4j-test') && stdout.includes('running')
  } catch {
    return false
  }
}

async function waitForHealthy(maxAttempts = 60): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { stdout } = await execAsync('docker-compose ps', { cwd: process.cwd() })
      if (stdout.includes('(healthy)')) {
        // Extra wait for Neo4j to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 2000))
        return
      }
    } catch {
      // Ignore errors during health check
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Neo4j failed to become healthy within timeout')
}

export async function startNeo4j(): Promise<void> {
  // Check if container is already running
  const alreadyRunning = await isContainerRunning()

  if (alreadyRunning) {
    console.log('Neo4j container already running, reusing...')
    weStartedContainer = false
    return
  }

  console.log('Starting Neo4j test container...')
  weStartedContainer = true

  await execAsync('docker-compose up -d', { cwd: process.cwd() })
  await waitForHealthy()

  console.log('Neo4j is ready!')
}

export async function stopNeo4j(): Promise<void> {
  if (!weStartedContainer) {
    console.log('Neo4j was already running before tests, leaving it up.')
    return
  }

  console.log('Stopping Neo4j test container...')
  await execAsync('docker-compose down -v', { cwd: process.cwd() })
}

// Global setup/teardown hooks
export async function setup(): Promise<void> {
  await startNeo4j()
}

export async function teardown(): Promise<void> {
  await stopNeo4j()
}
