/**
 * Utilities Module
 */

export type { DeepReadonly, Prettify, UnionToIntersection, IsNever, IsAny } from './types'

export {
  convertNeo4jValue,
  convertNeo4jProperties,
  extractProperties,
  extractValue,
  extractNodeFromRecord,
  transformResults,
  transformMultiAliasResults,
} from './neo4j'

export { isDateSchema, deserializeDateFields } from './dates'
