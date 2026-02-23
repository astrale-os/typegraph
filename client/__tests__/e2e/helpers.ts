/**
 * E2E Test Helpers
 *
 * Shared utilities for the E2E test suite.
 */

import { createQueryBuilder } from '../../src'
import { schema } from './schema'

/** Pre-built query builder for the e-commerce schema. */
export const q = createQueryBuilder(schema)

/** Normalize Cypher for assertion (collapse whitespace, trim). */
export function cypher(template: TemplateStringsArray, ...values: unknown[]): string {
  const raw = String.raw(template, ...values)
  return raw
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}
