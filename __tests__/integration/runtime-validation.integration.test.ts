/**
 * Integration Tests: Runtime Type Safety & Validation
 *
 * Tests schema validation, type checking, constraint enforcement, and error handling.
 * Verifies the system properly validates data at runtime and provides clear errors.
 */

import { fail } from 'assert'
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
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Invalid Email User',
          email: 'not-an-email', // Invalid format
          status: 'active' as const,
        },
        { id: 'invalid-email-user' },
      ),
    ).rejects.toThrow()
  })

  it('create with invalid enum value fails validation', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Invalid Status User',
          email: 'invalid@test.com',
          status: 'unknown' as any, // Not in enum
        },
        { id: 'invalid-status-user' },
      ),
    ).rejects.toThrow()
  })

  it('create with missing required field fails', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Missing Field User',
          // Missing email (required)
          status: 'active' as const,
        } as any,
        { id: 'missing-field-user' },
      ),
    ).rejects.toThrow()
  })

  it('create with invalid type for field fails', async () => {
    await expect(
      ctx.graph.mutate.create(
        'post',
        {
          title: 'Test',
          views: 'not-a-number' as any, // Should be number
        },
        { id: 'invalid-type-post' },
      ),
    ).rejects.toThrow()
  })

  it('create with optional field as undefined succeeds', async () => {
    const result = await ctx.graph.mutate.create(
      'user',
      {
        name: 'No Age',
        email: 'noage@test.com',
        status: 'active' as const,
        age: undefined, // Optional
      },
      { id: 'optional-age-user' },
    )

    expect(result.id).toBe('optional-age-user')
    expect(result.data.age).toBeUndefined()
  })

  it('create with default value not provided uses default', async () => {
    const result = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Default Status',
        email: 'default@test.com',
        // status not provided, should use default 'active'
      },
      { id: 'default-status-user' },
    )

    expect(result.data.status).toBe('active')
  })

  it('update with partial data preserves other fields', async () => {
    const result = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Original Name',
        email: 'original@test.com',
        status: 'active' as const,
      },
      { id: 'partial-update-user' },
    )

    // Update only name
    const updated = await ctx.graph.mutate.update('user', result.id, {
      name: 'Updated Name',
    })

    expect(updated.data.name).toBe('Updated Name')
    expect(updated.data.email).toBe('original@test.com') // Unchanged
    expect(updated.data.status).toBe('active') // Unchanged
  })

  it('update with invalid data fails validation', async () => {
    const result = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Test',
        email: 'test@test.com',
        status: 'active' as const,
      },
      { id: 'update-validation-user' },
    )

    await expect(
      ctx.graph.mutate.update('user', result.id, {
        email: 'invalid-email-format',
      }),
    ).rejects.toThrow()

    // Verify original data unchanged
    const unchanged = await ctx.graph.nodeByIdWithLabel('user', result.id).execute()
    expect(unchanged.email).toBe('test@test.com')
  })

  it('create with extra fields not in schema - stripped or preserved?', async () => {
    // Cast the entire object to any to test extra field handling
    const result = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Extra Fields',
        email: 'extra@test.com',
        status: 'active' as const,
        extraField: 'should be ignored',
        anotherExtra: 123,
      } as any,
      { id: 'extra-fields-user' },
    )

    // Verify known fields exist
    expect(result.data.name).toBe('Extra Fields')
    expect(result.data.email).toBe('extra@test.com')

    // Extra fields might be stripped by validation or preserved by DB
    // Query to check what's actually in the database
    const [dbResult] = await ctx.graph.raw<Record<string, unknown>>(
      `MATCH (u:User {id: $id}) RETURN u`,
      { id: result.id },
    )

    expect(dbResult).toBeDefined()
  })

  it('batch create with mixed valid/invalid - all or nothing', async () => {
    const users = [
      {
        name: 'Valid1',
        email: 'valid1@test.com',
        status: 'active' as const,
      },
      {
        name: 'Invalid',
        email: 'not-an-email', // Invalid
        status: 'active' as const,
      },
      {
        name: 'Valid2',
        email: 'valid2@test.com',
        status: 'active' as const,
      },
    ]

    await expect(ctx.graph.mutate.createMany('user', users)).rejects.toThrow()

    // Verify none were created (atomic) - check by email since IDs are auto-generated
    const count1 = await ctx.graph.node('user').where('email', 'eq', 'valid1@test.com').count()
    const count2 = await ctx.graph.node('user').where('email', 'eq', 'valid2@test.com').count()

    expect(count1).toBe(0)
    expect(count2).toBe(0)
  })

  it('link with edge properties validates property types', async () => {
    const alice = ctx.data.users.alice
    const post = ctx.data.posts.hello

    // authored edge has role property (enum)
    await expect(
      ctx.graph.mutate.link('authored', alice, post, {
        role: 'invalid-role' as any,
      }),
    ).rejects.toThrow()
  })

  it('link with valid edge properties succeeds', async () => {
    const testUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'EdgePropsUser',
        email: 'edgeprops@test.com',
        status: 'active' as const,
      },
      { id: 'edge-props-user' },
    )

    const testPost = await ctx.graph.mutate.create(
      'post',
      {
        title: 'Edge Props Post',
        views: 0,
      },
      { id: 'edge-props-post' },
    )

    await ctx.graph.mutate.link('authored', testUser.id, testPost.id, {
      role: 'coauthor',
    })

    // Verify edge was created with properties
    const [result] = await ctx.graph.raw<{ role: string }>(
      `MATCH (u:User {id: $userId})-[r:authored]->(p:Post {id: $postId})
       RETURN r.role as role`,
      { userId: testUser.id, postId: testPost.id },
    )

    expect(result).toBeDefined()
    expect(result!.role).toBe('coauthor')
  })

  it('empty string for required field fails validation', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: '', // Empty string for required field
          email: 'empty@test.com',
          status: 'active' as const,
        },
        { id: 'empty-name-user' },
      ),
    ).rejects.toThrow()
  })

  it('null for required field fails validation', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: null as any,
          email: 'null@test.com',
          status: 'active' as const,
        },
        { id: 'null-name-user' },
      ),
    ).rejects.toThrow()
  })

  it('negative number where positive required fails validation', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Negative Age',
          email: 'negative@test.com',
          status: 'active' as const,
          age: -5, // Schema requires positive int
        },
        { id: 'negative-age-user' },
      ),
    ).rejects.toThrow()
  })

  it('float where integer required fails validation', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Float Age',
          email: 'float@test.com',
          status: 'active' as const,
          age: 25.5, // Schema requires int
        },
        { id: 'float-age-user' },
      ),
    ).rejects.toThrow()
  })

  it('string title with minimum length validation', async () => {
    // title has min(1) validation
    await expect(
      ctx.graph.mutate.create(
        'post',
        {
          title: '', // Empty string, min is 1
          views: 0,
        },
        { id: 'empty-title-post' },
      ),
    ).rejects.toThrow()
  })

  it('valid minimum length string succeeds', async () => {
    const result = await ctx.graph.mutate.create(
      'post',
      {
        title: 'A', // Exactly minimum length
        views: 0,
      },
      { id: 'min-length-post' },
    )

    expect(result.data.title).toBe('A')
  })

  it('date field validation', async () => {
    const validDate = new Date()

    const result = await ctx.graph.mutate.create(
      'user',
      {
        name: 'DateUser',
        email: 'date@test.com',
        status: 'active' as const,
        createdAt: validDate,
      },
      { id: 'date-user' },
    )

    expect(result.data.createdAt).toBeInstanceOf(Date)
    expect(result.data.createdAt!.toISOString()).toBe(validDate.toISOString())
  })

  it('invalid date string fails validation', async () => {
    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: 'InvalidDate',
          email: 'invaliddate@test.com',
          status: 'active' as const,
          createdAt: 'not-a-date' as any,
        },
        { id: 'invalid-date-user' },
      ),
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
      ctx.graph.mutate.upsert('user', 'upsert-invalid', {
        name: 'Upsert Test',
        email: 'invalid-email', // Invalid
        status: 'active' as const,
      }),
    ).rejects.toThrow()
  })

  it('upsert with valid data creates when not exists', async () => {
    const result = await ctx.graph.mutate.upsert('user', 'upsert-create', {
      name: 'UpsertCreate',
      email: 'upsertcreate@test.com',
      status: 'active' as const,
    })

    expect(result.id).toBe('upsert-create')
    expect(result.data.name).toBe('UpsertCreate')
  })

  it('upsert with valid data updates when exists', async () => {
    // Create first
    await ctx.graph.mutate.create(
      'user',
      {
        name: 'Original',
        email: 'original@test.com',
        status: 'active' as const,
      },
      { id: 'upsert-update' },
    )

    // Upsert with new name
    const updated = await ctx.graph.mutate.upsert('user', 'upsert-update', {
      name: 'Updated',
      email: 'original@test.com',
      status: 'active' as const,
    })

    expect(updated.data.name).toBe('Updated')
  })

  it('query with incorrect node label returns empty', async () => {
    // Try to query post as user - should not find anything
    const results = await ctx.graph.node('user').where('id', 'eq', ctx.data.posts.hello).execute()
    expect(results).toHaveLength(0)
  })

  it('traverse with wrong edge type returns empty', async () => {
    const alice = ctx.data.users.alice

    // User doesn't have 'hasComment' edge (that's from Post)
    const results = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('hasComment' as any)
      .execute()
    expect(results).toHaveLength(0)
  })

  it('error messages are descriptive', async () => {
    try {
      await ctx.graph.mutate.create(
        'user',
        {
          name: 'Test',
          email: 'invalid-email',
          status: 'active' as const,
        },
        { id: 'error-message-test' },
      )
      fail('Should have thrown')
    } catch (error) {
      const errorMessage = (error as Error).message
      // Error should mention 'email' or 'validation'
      expect(errorMessage.toLowerCase()).toMatch(/email|validation|invalid/i)
    }
  })
})
