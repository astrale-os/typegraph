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
  InstanceModelConfig,
  TypeMap,
  UntypedMap,
  Cardinality,
} from './types'

// Schema extension
export { mergeSchemaExtension, type MergeResult } from './extend'

// Structural edge & meta-label constants
export { STRUCTURAL_EDGES, STRUCTURAL_EDGE_SET, META_LABELS } from './structural-edges'
