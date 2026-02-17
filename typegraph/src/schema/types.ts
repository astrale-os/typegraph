/**
 * Schema Shape
 *
 * Defines the shape of the `schema` const emitted by codegen.
 * The universal constraint for the Graph type parameter.
 *
 * The old system inferred types from Zod schemas at the TypeScript level.
 * The new system uses concrete types directly from codegen output.
 */

// ─── Schema Metadata (runtime value) ────────────────────────

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
 * Instance model configuration.
 * When enabled, the compilation passes rewrite label-based matching
 * into structural instance_of joins to class/interface nodes.
 *
 * Produced by `materializeSchema()` — see kernel/boot/bootstrap.ts.
 * Attached to SchemaShape at runtime, not by codegen.
 */
export interface InstanceModelConfig {
  /** Whether to use the instance model. */
  readonly enabled: boolean
  /**
   * Refs mapping: type name → node ID for class and interface nodes.
   * Populated at bootstrap or from codegen. All lookups are by ID, never by name.
   */
  readonly refs: Readonly<Record<string, string>>
  /**
   * Pre-resolved implementor map: interface name → class node IDs
   * that implement it (transitively through extends).
   * Avoids runtime joins through implements/extends.
   */
  readonly implementors: Readonly<Record<string, readonly string[]>>
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
  /** Instance model configuration. When set and enabled, compilation passes use structural type membership. */
  readonly instanceModel?: InstanceModelConfig
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
