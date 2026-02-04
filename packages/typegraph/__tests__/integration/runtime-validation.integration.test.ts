/**
 * Integration Tests: Runtime Type Safety & Validation
 *
 * Tests schema validation, type checking, constraint enforcement, and error handling.
 * Verifies the system properly validates data at runtime and provides clear errors.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Runtime Validation', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('create with invalid email format fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'invalid-email-user',
        name: 'Invalid Email User',
        email: 'not-an-email', // Invalid format
        status: 'active' as const,
      }),
    ).rejects.toThrow()
  })

  it('create with invalid enum value fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'invalid-status-user',
        name: 'Invalid Status User',
        email: 'invalid@test.com',
        status: 'unknown' as any, // Not in enum
      }),
    ).rejects.toThrow()
  })

  it('create with missing required field fails', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'missing-field-user',
        name: 'Missing Field User',
        // Missing email (required)
        status: 'active' as const,
      } as any),
    ).rejects.toThrow()
  })

  it('create with invalid type for field fails', async () => {
    await expect(
      ctx.graph.create('post', {
        id: 'invalid-type-post',
        title: 'Test',
        views: 'not-a-number' as any, // Should be number
      }),
    ).rejects.toThrow()
  })

  it('create with optional field as undefined succeeds', async () => {
    const user = await ctx.graph.create('user', {
      id: 'optional-age-user',
      name: 'No Age',
      email: 'noage@test.com',
      status: 'active' as const,
      age: undefined, // Optional
    })

    expect(user.id).toBe('optional-age-user')
    expect(user.age).toBeUndefined()
  })

  it('create with default value not provided uses default', async () => {
    const user = await ctx.graph.create('user', {
      id: 'default-status-user',
      name: 'Default Status',
      email: 'default@test.com',
      // status not provided, should use default 'active'
    })

    expect(user.status).toBe('active')
  })

  it('update with partial data preserves other fields', async () => {
    const user = await ctx.graph.create('user', {
      id: 'partial-update-user',
      name: 'Original Name',
      email: 'original@test.com',
      status: 'active' as const,
    })

    // Update only name
    const updated = await ctx.graph.update('user', user.id, {
      name: 'Updated Name',
    })

    expect(updated.name).toBe('Updated Name')
    expect(updated.email).toBe('original@test.com') // Unchanged
    expect(updated.status).toBe('active') // Unchanged
  })

  it('update with invalid data fails validation', async () => {
    const user = await ctx.graph.create('user', {
      id: 'update-validation-user',
      name: 'Test',
      email: 'test@test.com',
      status: 'active' as const,
    })

    await expect(
      ctx.graph.update('user', user.id, {
        email: 'invalid-email-format',
      }),
    ).rejects.toThrow()

    // Verify original data unchanged
    const unchanged = await ctx.graph.nodeByIdWithLabel('user', user.id).execute()
    expect(unchanged.email).toBe('test@test.com')
  })

  it('create with extra fields not in schema - stripped or preserved?', async () => {
    const result = await ctx.graph.create('user', {
      id: 'extra-fields-user',
      name: 'Extra Fields',
      email: 'extra@test.com',
      status: 'active' as const,
      extraField: 'should be ignored' as any,
      anotherExtra: 123 as any,
    })

    // Verify known fields exist
    expect(result.name).toBe('Extra Fields')
    expect(result.email).toBe('extra@test.com')

    // Extra fields might be stripped by validation or preserved by DB
    // Query to check what's actually in the database
    const [dbResult] = await ctx.connection.run<Record<string, unknown>>(
      `MATCH (u:Node:User {id: $id}) RETURN u`,
      { id: result.id },
    )

    expect(dbResult).toBeDefined()
  })

  it('batch create with mixed valid/invalid - all or nothing', async () => {
    const users = [
      {
        id: 'batch-valid-1',
        name: 'Valid1',
        email: 'valid1@test.com',
        status: 'active' as const,
      },
      {
        id: 'batch-invalid',
        name: 'Invalid',
        email: 'not-an-email', // Invalid
        status: 'active' as const,
      },
      {
        id: 'batch-valid-2',
        name: 'Valid2',
        email: 'valid2@test.com',
        status: 'active' as const,
      },
    ]

    await expect(ctx.graph.createMany('user', users)).rejects.toThrow()

    // Verify none were created (atomic)
    const exists1 = await ctx.graph.node('user').where('id', 'eq', 'batch-valid-1').exists()
    const exists2 = await ctx.graph.node('user').where('id', 'eq', 'batch-valid-2').exists()

    expect(exists1).toBe(false)
    expect(exists2).toBe(false)
  })

  it('link with edge properties validates property types', async () => {
    const alice = ctx.data.users.alice
    const post = ctx.data.posts.hello

    // authored edge has role property (enum)
    await expect(
      ctx.graph.link('authored', alice, post, {
        role: 'invalid-role' as any,
      }),
    ).rejects.toThrow()
  })

  it('link with valid edge properties succeeds', async () => {
    const testUser = await ctx.graph.create('user', {
      id: 'edge-props-user',
      name: 'EdgePropsUser',
      email: 'edgeprops@test.com',
      status: 'active' as const,
    })

    const testPost = await ctx.graph.create('post', {
      id: 'edge-props-post',
      title: 'Edge Props Post',
      views: 0,
    })

    await ctx.graph.link('authored', testUser.id, testPost.id, {
      role: 'coauthor',
    })

    // Verify edge was created with properties
    const [result] = await ctx.connection.run<{ role: string }>(
      `MATCH (u:Node:User {id: $userId})-[r:authored]->(p:Node:Post {id: $postId})
       RETURN r.role as role`,
      { userId: testUser.id, postId: testPost.id },
    )

    expect(result).toBeDefined()
    expect(result!.role).toBe('coauthor')
  })

  it('empty string for required field fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'empty-name-user',
        name: '', // Empty string for required field
        email: 'empty@test.com',
        status: 'active' as const,
      }),
    ).rejects.toThrow()
  })

  it('null for required field fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'null-name-user',
        name: null as any,
        email: 'null@test.com',
        status: 'active' as const,
      }),
    ).rejects.toThrow()
  })

  it('negative number where positive required fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'negative-age-user',
        name: 'Negative Age',
        email: 'negative@test.com',
        status: 'active' as const,
        age: -5, // Schema requires positive int
      }),
    ).rejects.toThrow()
  })

  it('float where integer required fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'float-age-user',
        name: 'Float Age',
        email: 'float@test.com',
        status: 'active' as const,
        age: 25.5, // Schema requires int
      }),
    ).rejects.toThrow()
  })

  it('string title with minimum length validation', async () => {
    // title has min(1) validation
    await expect(
      ctx.graph.create('post', {
        id: 'empty-title-post',
        title: '', // Empty string, min is 1
        views: 0,
      }),
    ).rejects.toThrow()
  })

  it('valid minimum length string succeeds', async () => {
    const post = await ctx.graph.create('post', {
      id: 'min-length-post',
      title: 'A', // Exactly minimum length
      views: 0,
    })

    expect(post.title).toBe('A')
  })

  it('date field validation', async () => {
    const validDate = new Date()

    const user = await ctx.graph.create('user', {
      id: 'date-user',
      name: 'DateUser',
      email: 'date@test.com',
      status: 'active' as const,
      createdAt: validDate,
    })

    expect(user.createdAt).toBeInstanceOf(Date)
    expect(user.createdAt!.toISOString()).toBe(validDate.toISOString())
  })

  it('invalid date string fails validation', async () => {
    await expect(
      ctx.graph.create('user', {
        id: 'invalid-date-user',
        name: 'InvalidDate',
        email: 'invaliddate@test.com',
        status: 'active' as const,
        createdAt: 'not-a-date' as any,
      }),
    ).rejects.toThrow()
  })

  it('query returns data matching schema types', async () => {
    const alice = ctx.data.users.alice

    const user = await ctx.graph.nodeByIdWithLabel('user', alice).execute()

    // Verify types
    expect(typeof user.id).toBe('string')
    expect(typeof user.name).toBe('string')
    expect(typeof user.email).toBe('string')
    expect(['active', 'inactive']).toContain(user.status)

    if (user.age !== undefined) {
      expect(typeof user.age).toBe('number')
      expect(Number.isInteger(user.age)).toBe(true)
      expect(user.age).toBeGreaterThan(0)
    }
  })

  it('upsert with invalid data on create fails', async () => {
    await expect(
      ctx.graph.upsert('user', 'upsert-invalid', {
        name: 'Upsert Test',
        email: 'invalid-email', // Invalid
        status: 'active' as const,
      }),
    ).rejects.toThrow()
  })

  it('upsert with valid data creates when not exists', async () => {
    const user = await ctx.graph.upsert('user', 'upsert-create', {
      name: 'UpsertCreate',
      email: 'upsertcreate@test.com',
      status: 'active' as const,
    })

    expect(user.id).toBe('upsert-create')
    expect(user.name).toBe('UpsertCreate')
  })

  it('upsert with valid data updates when exists', async () => {
    // Create first
    await ctx.graph.create('user', {
      id: 'upsert-update',
      name: 'Original',
      email: 'original@test.com',
      status: 'active' as const,
    })

    // Upsert with new name
    const updated = await ctx.graph.upsert('user', 'upsert-update', {
      name: 'Updated',
      email: 'original@test.com',
      status: 'active' as const,
    })

    expect(updated.name).toBe('Updated')
  })

  it('query with incorrect node label returns empty', async () => {
    // Try to query post as user
    const query = ctx.graph.nodeByIdWithLabel('user', ctx.data.posts.hello)

    const result = await ctx.executor.executeOptional(query.compile())
    expect(result.data).toBeNull()
  })

  it('traverse with wrong edge type returns empty', async () => {
    const alice = ctx.data.users.alice

    // User doesn't have 'hasComment' edge (that's from Post)
    const query = ctx.graph.nodeByIdWithLabel('user', alice).to('hasComment' as any)

    const result = await ctx.executor.execute(query.compile())
    expect(result.data).toHaveLength(0)
  })

  it('error messages are descriptive', async () => {
    try {
      await ctx.graph.create('user', {
        id: 'error-message-test',
        name: 'Test',
        email: 'invalid-email',
        status: 'active' as const,
      })
      fail('Should have thrown')
    } catch (error) {
      const errorMessage = (error as Error).message
      // Error should mention 'email' or 'validation'
      expect(errorMessage.toLowerCase()).toMatch(/email|validation|invalid/i)
    }
  })
})
