/**
 * Schema Domain — Core graph model types and structural constants.
 */

// Schema shape & type system
export type {
  SchemaShape,
  SchemaNodeDef,
  SchemaEdgeDef,
  SchemaEndpointDef,
  SchemaConstraints,
  SchemaMethodDef,
  HierarchyConfig,
  TypeMap,
  UntypedMap,
  Cardinality,
  ClassRefs,
} from './types'

// Branded ID types and constructors (both type and value exports)
export { NodeId, ClassId, InterfaceId } from './types'

// Schema extension
export { mergeSchemaExtension, type MergeResult } from './extend'

// Structural edge & meta-label constants
export { STRUCTURAL_EDGES, STRUCTURAL_EDGE_SET, META_LABELS } from './structural-edges'
