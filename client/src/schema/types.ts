/**
 * Schema Shape
 *
 * Defines the shape of the `schema` const emitted by codegen.
 * The universal constraint for the Graph type parameter.
 */

// ─── Branded ID Types ────────────────────────────────────────

/**
 * Branded ID types for type safety at the schema level.
 */
type NodeBrand = { readonly __nodeId: true }
type ClassBrand = { readonly __classId: true }
type InterfaceBrand = { readonly __interfaceId: true }

export type NodeId = string & NodeBrand
export type ClassId = NodeId & ClassBrand
export type InterfaceId = NodeId & InterfaceBrand

/**
 * Type constructors for branded IDs.
 */
export const NodeId = (id: string): NodeId => id as NodeId
export const ClassId = (id: string): ClassId => id as ClassId
export const InterfaceId = (id: string): InterfaceId => id as InterfaceId

// ─── Schema Metadata (runtime value) ────────────────────────

/**
 * Materialized class/interface references.
 * Maps type names (e.g., 'customer', 'order', 'Node') to their meta-node IDs.
 * Set at runtime by `materializeSchema()` via `graph.extendSchema({ classRefs })`.
 */
export type ClassRefs = Readonly<Record<string, ClassId | InterfaceId>>

export interface SchemaNodeDef {
  readonly abstract: boolean
  readonly implements?: readonly string[]
  readonly attributes?: readonly string[]
}

export interface SchemaEndpointDef {
  readonly types: readonly string[]
  readonly cardinality?: { readonly min: number; readonly max: number | null }
}

export interface SchemaEdgeDef {
  readonly endpoints: Readonly<Record<string, SchemaEndpointDef>>
  readonly constraints?: Readonly<Partial<SchemaConstraints>>
  readonly attributes?: readonly string[]
  /** Per-edge override for reification. Inherits global `reifyEdges` if omitted. */
  readonly reified?: boolean
}

export interface SchemaConstraints {
  readonly no_self: boolean
  readonly acyclic: boolean
  readonly unique: boolean
  readonly symmetric: boolean
}

export interface SchemaMethodDef {
  readonly params: Readonly<Record<string, { readonly type: string; readonly default?: unknown }>>
  readonly returns: string
}

export interface HierarchyConfig {
  readonly defaultEdge: string
  readonly direction: 'up' | 'down'
}

/**
 * Shape of the generated `schema` const.
 * Every codegen output's `schema` satisfies this interface.
 */
export interface SchemaShape {
  readonly scalars?: readonly string[]
  readonly nodes: Readonly<Record<string, SchemaNodeDef>>
  readonly edges: Readonly<Record<string, SchemaEdgeDef>>
  readonly methods?: Readonly<Record<string, Record<string, SchemaMethodDef>>>
  readonly hierarchy?: HierarchyConfig
  /** Global default for edge reification. Per-edge `reified` overrides this. */
  readonly reifyEdges?: boolean
  /**
   * Materialized class/interface refs: type name -> node ID.
   * Set by `materializeSchema()` via `graph.extendSchema({ classRefs })`.
   * When present, compilation passes use structural instance_of joins.
   */
  readonly classRefs?: ClassRefs
}

// ─── Type Map (generated types) ──────────────────────────────

/**
 * Maps type names to their TypeScript types.
 * Codegen produces concrete types (Customer, Product, etc.) — the TypeMap
 * provides the bridge from string names to those types.
 *
 * When the developer doesn't provide a TypeMap, the SDK falls back to
 * `Record<string, unknown>` for all types — still functional, just untyped.
 */
export interface TypeMap {
  /** Node type name → enriched node type (e.g., { Customer: CustomerNode, Product: ProductNode }) */
  readonly nodes: Record<string, unknown>
  /** Edge type name → edge payload type (e.g., { order_item: OrderItemPayload }) */
  readonly edges: Record<string, unknown>
  /** Node type name → mutation input type (e.g., { Customer: CustomerInput }). Optional — falls back to Record<string, unknown>. */
  readonly nodeInputs?: Record<string, unknown>
}

/**
 * Default TypeMap when no generated types are provided.
 * Everything is `Record<string, unknown>`.
 */
export interface UntypedMap extends TypeMap {
  readonly nodes: Record<string, Record<string, unknown>>
  readonly edges: Record<string, Record<string, unknown>>
}

// ─── Cardinality ─────────────────────────────────────────────

export type Cardinality = 'one' | 'many' | 'optional'
