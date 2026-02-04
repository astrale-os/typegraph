/**
 * Schema Index Compiler
 *
 * Generates CREATE INDEX/CONSTRAINT Cypher statements from schema definitions.
 * Supports single-property and composite indexes for Neo4j/Memgraph/FalkorDB.
 */

import type { AnySchema, NodeDefinition, EdgeDefinition } from './types'
import { toPascalCase } from './labels'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for compiling schema indexes to Cypher.
 */
export interface IndexCompilerOptions {
  /** Use IF NOT EXISTS clause for idempotent index creation. Default: false */
  ifNotExists?: boolean
  /** Include the implicit :Node base label index. Default: true */
  includeBaseIndexes?: boolean
}

/**
 * A compiled index ready for execution.
 */
export interface CompiledIndex {
  /** The CREATE INDEX/CONSTRAINT Cypher statement */
  cypher: string
  /** Generated or user-provided index name */
  name: string
  /** Target label (PascalCase for nodes, UPPER_CASE for relationships) */
  label: string
  /** Properties included in the index */
  properties: string[]
  /** Index type */
  type: 'btree' | 'fulltext' | 'unique'
  /** Whether this is a composite (multi-property) index */
  isComposite: boolean
  /** Whether this is for a relationship (edge) */
  isRelationship: boolean
}

// =============================================================================
// INDEX COMPILATION
// =============================================================================

/**
 * Compiles all indexes from a schema to Cypher CREATE INDEX/CONSTRAINT statements.
 *
 * @param schema - The schema definition containing nodes and edges
 * @param options - Compilation options
 * @returns Array of compiled indexes ready for execution
 *
 * @example
 * ```typescript
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({
 *       properties: { email: z.string(), firstName: z.string(), lastName: z.string() },
 *       indexes: [
 *         'email',
 *         { properties: ['firstName', 'lastName'], type: 'btree' },
 *       ],
 *     }),
 *   },
 *   edges: {},
 * })
 *
 * const indexes = compileSchemaIndexes(schema, { ifNotExists: true })
 * for (const idx of indexes) {
 *   await executor.run(idx.cypher)
 * }
 * ```
 */
export function compileSchemaIndexes(
  schema: AnySchema,
  options: IndexCompilerOptions = {},
): CompiledIndex[] {
  const { ifNotExists = false, includeBaseIndexes = true } = options
  const results: CompiledIndex[] = []

  // Add base :Node index for universal id lookups
  if (includeBaseIndexes) {
    results.push({
      cypher: `CREATE INDEX${ifNotExists ? ' IF NOT EXISTS' : ''} FOR (n:Node) ON (n.id)`,
      name: 'idx_node_id',
      label: 'Node',
      properties: ['id'],
      type: 'btree',
      isComposite: false,
      isRelationship: false,
    })
  }

  // Process node indexes
  for (const [nodeKey, nodeDef] of Object.entries(schema.nodes)) {
    const label = toPascalCase(nodeKey)
    const nodeDefinition = nodeDef as NodeDefinition
    const indexes = nodeDefinition.indexes ?? []

    for (const idx of indexes) {
      const compiled = compileNodeIndex(label, idx, ifNotExists)
      if (compiled) {
        results.push(compiled)
      }
    }
  }

  // Process edge indexes (relationship property indexes)
  for (const [edgeKey, edgeDef] of Object.entries(schema.edges)) {
    const relType = edgeKey.toUpperCase()
    const edgeDefinition = edgeDef as EdgeDefinition
    const indexes = edgeDefinition.indexes ?? []

    for (const idx of indexes) {
      const compiled = compileRelationshipIndex(relType, idx, ifNotExists)
      if (compiled) {
        results.push(compiled)
      }
    }
  }

  return results
}

/**
 * Compiles a single node index entry to Cypher.
 */
function compileNodeIndex(
  label: string,
  indexEntry: unknown,
  ifNotExists: boolean,
): CompiledIndex | null {
  const ifne = ifNotExists ? ' IF NOT EXISTS' : ''

  // Simple string property: 'email'
  if (typeof indexEntry === 'string') {
    const name = `idx_${label.toLowerCase()}_${indexEntry}`
    return {
      cypher: `CREATE INDEX${ifne} FOR (n:${label}) ON (n.${indexEntry})`,
      name,
      label,
      properties: [indexEntry],
      type: 'btree',
      isComposite: false,
      isRelationship: false,
    }
  }

  // Object config
  if (typeof indexEntry === 'object' && indexEntry !== null) {
    // Type-safe check: does it have a 'property' field?
    if ('property' in indexEntry && typeof indexEntry.property === 'string') {
      const config = indexEntry as { property: string; type?: string; name?: string }
      const prop = config.property
      const type = (config.type as 'btree' | 'fulltext' | 'unique') ?? 'btree'
      const name = config.name ?? `idx_${label.toLowerCase()}_${prop}`

      if (type === 'unique') {
        return {
          cypher: `CREATE CONSTRAINT${ifne} FOR (n:${label}) REQUIRE n.${prop} IS UNIQUE`,
          name,
          label,
          properties: [prop],
          type: 'unique',
          isComposite: false,
          isRelationship: false,
        }
      }

      if (type === 'fulltext') {
        // Neo4j fulltext index syntax
        return {
          cypher: `CREATE FULLTEXT INDEX ${name}${ifne} FOR (n:${label}) ON EACH [n.${prop}]`,
          name,
          label,
          properties: [prop],
          type: 'fulltext',
          isComposite: false,
          isRelationship: false,
        }
      }

      return {
        cypher: `CREATE INDEX${ifne} FOR (n:${label}) ON (n.${prop})`,
        name,
        label,
        properties: [prop],
        type: 'btree',
        isComposite: false,
        isRelationship: false,
      }
    }

    // Composite index: { properties: ['firstName', 'lastName'], type: 'btree' }
    if ('properties' in indexEntry && Array.isArray(indexEntry.properties)) {
      const config = indexEntry as {
        properties: readonly string[]
        type?: string
        order?: Record<string, 'ASC' | 'DESC'>
        name?: string
      }
      const props = config.properties
      const type = (config.type as 'btree' | 'unique') ?? 'btree'
      const order = config.order
      const name = config.name ?? `idx_${label.toLowerCase()}_${props.join('_')}`

      // Build property list with optional ordering
      const propList = props
        .map((p) => {
          const dir = order?.[p]
          return dir ? `n.${p} ${dir}` : `n.${p}`
        })
        .join(', ')

      if (type === 'unique') {
        // Neo4j NODE KEY constraint for composite unique
        const reqList = props.map((p) => `n.${p}`).join(', ')
        return {
          cypher: `CREATE CONSTRAINT${ifne} FOR (n:${label}) REQUIRE (${reqList}) IS NODE KEY`,
          name,
          label,
          properties: [...props],
          type: 'unique',
          isComposite: true,
          isRelationship: false,
        }
      }

      return {
        cypher: `CREATE INDEX${ifne} FOR (n:${label}) ON (${propList})`,
        name,
        label,
        properties: [...props],
        type: 'btree',
        isComposite: true,
        isRelationship: false,
      }
    }
  }

  return null
}

/**
 * Compiles a relationship (edge) index entry to Cypher.
 * Note: Relationship property indexes are supported in Neo4j 5.x+
 */
function compileRelationshipIndex(
  relType: string,
  indexEntry: unknown,
  ifNotExists: boolean,
): CompiledIndex | null {
  const ifne = ifNotExists ? ' IF NOT EXISTS' : ''

  // Simple string property: 'since'
  if (typeof indexEntry === 'string') {
    const name = `idx_rel_${relType.toLowerCase()}_${indexEntry}`
    return {
      cypher: `CREATE INDEX${ifne} FOR ()-[r:${relType}]-() ON (r.${indexEntry})`,
      name,
      label: relType,
      properties: [indexEntry],
      type: 'btree',
      isComposite: false,
      isRelationship: true,
    }
  }

  // Object config
  if (typeof indexEntry === 'object' && indexEntry !== null) {
    // Single property index
    if ('property' in indexEntry && typeof indexEntry.property === 'string') {
      const config = indexEntry as { property: string; type?: string; name?: string }
      const prop = config.property
      const type = (config.type as 'btree' | 'fulltext' | 'unique') ?? 'btree'
      const name = config.name ?? `idx_rel_${relType.toLowerCase()}_${prop}`

      // Note: Relationship unique constraints and fulltext indexes have different syntax
      // For simplicity, we only generate btree indexes for relationships
      return {
        cypher: `CREATE INDEX${ifne} FOR ()-[r:${relType}]-() ON (r.${prop})`,
        name,
        label: relType,
        properties: [prop],
        type,
        isComposite: false,
        isRelationship: true,
      }
    }

    // Composite index for relationships
    if ('properties' in indexEntry && Array.isArray(indexEntry.properties)) {
      const config = indexEntry as { properties: readonly string[]; type?: string; name?: string }
      const props = config.properties
      const type = (config.type as 'btree' | 'unique') ?? 'btree'
      const name = config.name ?? `idx_rel_${relType.toLowerCase()}_${props.join('_')}`

      const propList = props.map((p) => `r.${p}`).join(', ')

      return {
        cypher: `CREATE INDEX${ifne} FOR ()-[r:${relType}]-() ON (${propList})`,
        name,
        label: relType,
        properties: [...props],
        type,
        isComposite: true,
        isRelationship: true,
      }
    }
  }

  return null
}

// =============================================================================
// MIGRATION HELPERS
// =============================================================================

/**
 * Migration script with up (create) and down (drop) statements.
 */
export interface IndexMigration {
  /** CREATE INDEX/CONSTRAINT statements */
  up: string[]
  /** DROP INDEX/CONSTRAINT statements */
  down: string[]
}

/**
 * Generates migration scripts from compiled indexes.
 *
 * @param indexes - Array of compiled indexes
 * @returns Migration object with up and down statements
 *
 * @example
 * ```typescript
 * const indexes = compileSchemaIndexes(schema)
 * const migration = generateIndexMigration(indexes)
 *
 * // Apply migration
 * for (const stmt of migration.up) {
 *   await executor.run(stmt)
 * }
 *
 * // Rollback migration
 * for (const stmt of migration.down) {
 *   await executor.run(stmt)
 * }
 * ```
 */
export function generateIndexMigration(indexes: CompiledIndex[]): IndexMigration {
  return {
    up: indexes.map((idx) => idx.cypher),
    down: indexes.map((idx) => {
      if (idx.type === 'unique') {
        return `DROP CONSTRAINT ${idx.name} IF EXISTS`
      }
      return `DROP INDEX ${idx.name} IF EXISTS`
    }),
  }
}
