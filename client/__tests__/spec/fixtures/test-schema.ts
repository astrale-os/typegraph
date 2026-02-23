/**
 * Test Schema Fixture
 *
 * Comprehensive schema in the new SchemaShape format.
 * Covers various edge cardinalities, polymorphic endpoints, and hierarchy.
 */

import type { SchemaShape } from '../../../src/schema'

// =============================================================================
// TEST SCHEMA DEFINITION (SchemaShape format)
// =============================================================================

export const testSchema = {
  scalars: ['String', 'Int', 'Float', 'Boolean', 'Date'],

  nodes: {
    user: {
      abstract: false,
      attributes: ['email', 'name', 'status', 'createdAt', 'score'],
    },
    post: {
      abstract: false,
      attributes: ['title', 'content', 'publishedAt', 'viewCount', 'tags'],
    },
    comment: {
      abstract: false,
      attributes: ['content', 'createdAt', 'edited'],
    },
    category: {
      abstract: false,
      attributes: ['name', 'slug', 'description'],
    },
    organization: {
      abstract: false,
      attributes: ['name', 'domain'],
    },
    folder: {
      abstract: false,
      attributes: ['name', 'color'],
    },
  },

  edges: {
    authored: {
      endpoints: {
        user: { types: ['user'] },
        post: { types: ['post'] },
      },
      attributes: ['role', 'contributedAt'],
    },
    likes: {
      endpoints: {
        user: { types: ['user'] },
        post: { types: ['post'] },
      },
      attributes: ['likedAt'],
    },
    follows: {
      endpoints: {
        follower: { types: ['user'] },
        followed: { types: ['user'] },
      },
      attributes: ['since', 'notifications'],
    },
    commentedOn: {
      endpoints: {
        comment: { types: ['comment'], cardinality: { min: 1, max: 1 } },
        post: { types: ['post'] },
      },
    },
    writtenBy: {
      endpoints: {
        comment: { types: ['comment'], cardinality: { min: 1, max: 1 } },
        user: { types: ['user'] },
      },
    },
    categorizedAs: {
      endpoints: {
        post: { types: ['post'] },
        category: { types: ['category'] },
      },
    },
    categoryParent: {
      endpoints: {
        child: { types: ['category'], cardinality: { min: 0, max: 1 } },
        parent: { types: ['category'] },
      },
    },
    memberOf: {
      endpoints: {
        user: { types: ['user'] },
        organization: { types: ['organization'] },
      },
      attributes: ['role', 'joinedAt'],
    },
    hasParent: {
      endpoints: {
        child: { types: ['folder'], cardinality: { min: 0, max: 1 } },
        parent: { types: ['folder'] },
      },
    },
    owns: {
      endpoints: {
        user: { types: ['user'] },
        folder: { types: ['folder'], cardinality: { min: 1, max: 1 } },
      },
    },
  },

  hierarchy: {
    defaultEdge: 'hasParent',
    direction: 'up' as const,
  },
} as const satisfies SchemaShape

export type TestSchema = typeof testSchema

// =============================================================================
// EXPECTED CYPHER OUTPUT HELPERS
// =============================================================================

export function normalizeCypher(cypher: string): string {
  return cypher
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\[\s+/g, '[')
    .replace(/\s+\]/g, ']')
    .replace(/{\s+/g, '{')
    .replace(/\s+}/g, '}')
    .replace(/,\s+/g, ', ')
}

export function cypherEquals(actual: string, expected: string): boolean {
  return normalizeCypher(actual) === normalizeCypher(expected)
}
