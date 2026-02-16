/**
 * Date Utilities
 *
 * Date serialization/deserialization for graph database round-trips.
 * Deserialization currently passes through — codegen validators handle
 * date awareness once wired.
 */

import type { SchemaShape } from '../schema'

/**
 * Deserialize date fields from ISO strings back to Date objects.
 * Currently a pass-through — will use codegen date metadata when available.
 */
export function deserializeDateFields(
  _schema: SchemaShape,
  _label: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return data
}
