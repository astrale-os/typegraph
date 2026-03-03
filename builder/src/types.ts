import type { z } from 'zod'

// ── Basic shapes ────────────────────────────────────────────────────────────

export type PropShape = Record<string, z.ZodType | BitmaskDef>
export type DataShape = Record<string, z.ZodType>
export type ParamShape = Record<string, z.ZodType>

export type IndexDef = string | { property: string; type?: 'btree' | 'fulltext' | 'unique' }

export type Cardinality = '0..1' | '1' | '0..*' | '1..*'
export type Access = 'private' | 'internal'

// ── Operation / Method ──────────────────────────────────────────────────────

export interface OpConfig {
  readonly params?: ParamShape | (() => ParamShape)
  readonly returns: z.ZodType
  readonly access?: Access
  readonly static?: boolean
}

export interface OpDef<out C extends OpConfig = OpConfig> {
  readonly __kind: 'op'
  readonly config: C
}

// ── Endpoint ────────────────────────────────────────────────────────────────

export interface EndpointCfg {
  readonly as: string
  readonly types: readonly (IfaceDef<any> | NodeDef<any>)[]
  readonly cardinality?: Cardinality
}

// ── Iface ───────────────────────────────────────────────────────────────────

export interface IfaceConfig {
  readonly extends?: readonly IfaceDef<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, OpDef>
}

export interface IfaceDef<out C extends IfaceConfig = IfaceConfig> {
  readonly __kind: 'iface'
  readonly __brand: unique symbol
  readonly config: C
}

// ── Node ────────────────────────────────────────────────────────────────────

export interface NodeConfig {
  readonly extends?: NodeDef<any>
  readonly implements?: readonly IfaceDef<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, OpDef>
}

export interface NodeDef<out C extends NodeConfig = NodeConfig> {
  readonly __kind: 'node'
  readonly __brand: unique symbol
  readonly config: C
}

// ── Edge ────────────────────────────────────────────────────────────────────

export interface EdgeConfig {
  readonly noSelf?: boolean
  readonly acyclic?: boolean
  readonly unique?: boolean
  readonly symmetric?: boolean
  readonly onDeleteSource?: 'cascade' | 'unlink' | 'prevent'
  readonly onDeleteTarget?: 'cascade' | 'unlink' | 'prevent'
  readonly props?: PropShape
  readonly methods?: Record<string, OpDef>
}

export interface EdgeDef<
  out From extends EndpointCfg = EndpointCfg,
  out To extends EndpointCfg = EndpointCfg,
  out C extends EdgeConfig = EdgeConfig,
> {
  readonly __kind: 'edge'
  readonly __brand: unique symbol
  readonly from: From
  readonly to: To
  readonly config: C
}

// ── Bitmask ─────────────────────────────────────────────────────────────────

export interface BitmaskDef {
  readonly __kind: 'bitmask'
}

// ── Inference utilities ─────────────────────────────────────────────────────

/** Extract own props from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractProps<D> = D extends { config: { props: infer P } } ? P : {}

/** Extract own data shape from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractData<D> = D extends { config: { data: infer P } } ? P : {}

/** Extract own methods from a def's config (not inherited) */
export type ExtractMethods<D> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  D extends { config: { methods: infer M extends Record<string, OpDef> } } ? M : {}

/** Infer Zod types in a PropShape to their runtime values */
export type InferProps<P> = {
  [K in keyof P]: P[K] extends BitmaskDef ? number : P[K] extends z.ZodType<infer O> ? O : never
}

// ── Shared traversal helpers ────────────────────────────────────────────────

/** Extract implements array from a NodeDef */
type ExtractImplements<D> =
  D extends NodeDef<infer C>
    ? C extends { implements: infer I extends readonly IfaceDef<any>[] }
      ? I
      : readonly []
    : readonly []

/** Extract extends NodeDef from a NodeDef */
type ExtractNodeExtends<D> =
  D extends NodeDef<infer C>
    ? C extends { extends: infer E extends NodeDef<any> }
      ? E
      : never
    : never

/** Collect all iface props via extends chain */
type CollectIfacePropsFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? InferProps<ExtractProps<Head>> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfacePropsFromList<Parents>
          : unknown
        : unknown) &
      CollectIfacePropsFromList<Tail>
  : unknown

/** Full inferred props for a NodeDef: own + inherited from implements + inherited from extends */
export type ExtractFullProps<D> =
  D extends NodeDef<any>
    ? InferProps<ExtractProps<D>> &
        CollectIfacePropsFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : ExtractFullProps<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? InferProps<ExtractProps<D>> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfacePropsFromList<Parents>
              : unknown
            : unknown)
      : D extends EdgeDef<any, any, infer EC>
        ? EC extends { props: infer P extends PropShape }
          ? InferProps<P>
          : unknown
        : unknown

/** Collect all iface data via extends chain */
type CollectIfaceDataFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? InferProps<ExtractData<Head>> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfaceDataFromList<Parents>
          : unknown
        : unknown) &
      CollectIfaceDataFromList<Tail>
  : unknown

/** Full inferred data for a NodeDef: own + inherited from implements + inherited from extends */
export type ExtractFullData<D> =
  D extends NodeDef<any>
    ? InferProps<ExtractData<D>> &
        CollectIfaceDataFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : ExtractFullData<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? InferProps<ExtractData<D>> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfaceDataFromList<Parents>
              : unknown
            : unknown)
      : unknown

/** Check if a def has any data (own or inherited) */
export type HasData<D> = keyof ExtractFullData<D> extends never ? false : true

/** Collect all iface props AND data via extends chain — single traversal */
type CollectIfaceInputFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? InferProps<ExtractProps<Head>> &
      InferProps<ExtractData<Head>> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfaceInputFromList<Parents>
          : unknown
        : unknown) &
      CollectIfaceInputFromList<Tail>
  : unknown

/** Full inferred props AND data — single traversal for node() input */
export type ExtractNodeInput<D> =
  D extends NodeDef<any>
    ? InferProps<ExtractProps<D>> &
        InferProps<ExtractData<D>> &
        CollectIfaceInputFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : ExtractNodeInput<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? InferProps<ExtractProps<D>> &
          InferProps<ExtractData<D>> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfaceInputFromList<Parents>
              : unknown
            : unknown)
      : D extends EdgeDef<any, any, infer EC>
        ? EC extends { props: infer P extends PropShape }
          ? InferProps<P>
          : unknown
        : unknown

// ── Inherited method collection ─────────────────────────────────────────────

/** Collect methods from an interface list (own + parent extends chain) */
type CollectIfaceMethodsFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? ExtractMethods<Head> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfaceMethodsFromList<Parents>
          : unknown
        : unknown) &
      CollectIfaceMethodsFromList<Tail>
  : unknown

/** All methods for a def: own + inherited from implements/extends */
export type AllMethods<D> =
  D extends NodeDef<any>
    ? ExtractMethods<D> &
        CollectIfaceMethodsFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : AllMethods<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? ExtractMethods<D> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfaceMethodsFromList<Parents>
              : unknown
            : unknown)
      : ExtractMethods<D>

// ── Method inference utilities ──────────────────────────────────────────────

/** Check if a def has methods (own or inherited) */
export type HasMethods<D> = keyof AllMethods<D> extends never ? false : true

/** Get method names from a def (own + inherited) */
export type ExtractMethodNames<D> = keyof AllMethods<D> & string

/** Get the config of a specific method (own or inherited) */
type GetMethodConfig<D, M extends string> = M extends keyof AllMethods<D>
  ? AllMethods<D>[M] extends OpDef<infer MC>
    ? MC
    : never
  : never

/** Check if a specific method on a def is static */
export type IsStaticMethod<D, M extends string> =
  GetMethodConfig<D, M> extends { static: true } ? true : false

/** Extract resolved params (handles thunks at type level) */
export type ExtractMethodParams<D, M extends string> =
  GetMethodConfig<D, M> extends { params: infer P }
    ? P extends (() => infer R extends ParamShape)
      ? R
      : P extends ParamShape
        ? P
        : Record<string, never>
    : Record<string, never>

/** Extract return type */
export type ExtractMethodReturns<D, M extends string> =
  GetMethodConfig<D, M> extends { returns: infer R extends z.ZodType } ? R : never

type MethodReturnValue<D, R extends z.ZodType> = R extends { readonly __data_self: true }
  ? D extends NodeDef<any> | IfaceDef<any>
    ? ExtractFullData<D>
    : never
  : R extends { readonly __data_grant: true; readonly __data_target: infer T }
    ? T extends NodeDef<any> | IfaceDef<any>
      ? ExtractFullData<T>
      : unknown
    : z.infer<R>

export type ExtractMethodReturnValue<D, M extends string> = MethodReturnValue<
  D,
  ExtractMethodReturns<D, M>
>

// ── Schema type ─────────────────────────────────────────────────────────────

type OnlyKind<D extends Record<string, any>, Kind extends string> = {
  [K in keyof D as D[K] extends { __kind: Kind } ? K : never]: D[K]
}

export interface Schema<D extends Record<string, any> = Record<string, any>> {
  readonly domain: string
  readonly defs: D
  readonly ifaces: OnlyKind<D, 'iface'>
  readonly nodes: OnlyKind<D, 'node'>
  readonly edges: OnlyKind<D, 'edge'>
}

// ── SchemaValidationError ───────────────────────────────────────────────────

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly expected?: string,
    public readonly received?: string,
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}

// ── Method self type ────────────────────────────────────────────────────────

/** Self type for a node or edge method */
export type MethodSelf<D> =
  D extends NodeDef<any>
    ? ExtractFullProps<D> & { readonly id: string }
    : D extends EdgeDef<any, any, infer EC>
      ? (EC extends { props: infer P } ? InferProps<P> : unknown) & {
          readonly id: string
          readonly from: string
          readonly to: string
        }
      : { readonly id: string }

// ── Schema-level type helpers (consumed by kernel-runtime) ─────────────────

/** Get the def for a given key from either nodes or edges */
export type DefForKey<S extends Schema, K extends string> = K extends keyof S['nodes']
  ? S['nodes'][K]
  : K extends keyof S['edges']
    ? S['edges'][K]
    : never

/** All keys (node or edge) that have methods */
export type MethodKeys<S extends Schema> =
  | {
      [K in keyof S['nodes'] & string]: HasMethods<S['nodes'][K]> extends true ? K : never
    }[keyof S['nodes'] & string]
  | {
      [K in keyof S['edges'] & string]: HasMethods<S['edges'][K]> extends true ? K : never
    }[keyof S['edges'] & string]

/** Infer params from a builder OpDef (handles thunk params) */
export type InferOpParams<D> =
  D extends OpDef<infer C>
    ? C extends { params: infer P }
      ? P extends (() => infer R extends ParamShape)
        ? InferProps<R>
        : P extends ParamShape
          ? InferProps<P>
          : Record<string, never>
      : Record<string, never>
    : Record<string, never>

/** Infer return type from a builder OpDef */
export type InferOpReturn<D> =
  D extends OpDef<infer C> ? (C extends { returns: z.ZodType<infer R> } ? R : unknown) : unknown

// ── Schema definition references ───────────────────────────────────────────

/**
 * All addressable definitions in a schema: top-level defs + qualified operations.
 * Used for total mappings (e.g., ID assignment) where every definition must be covered.
 */
export type SchemaDefs<S extends Schema> =
  | SchemaClassDefs<S>
  | SchemaOpDefs<S>

/** Top-level definition names only (interfaces, nodes, edges). */
export type SchemaClassDefs<S extends Schema> = keyof S['defs'] & string

/** Qualified operation refs: "ClassName.methodName" for all defs with methods. */
export type SchemaOpDefs<S extends Schema> = {
  [K in MethodKeys<S> & string]: `${K}.${ExtractMethodNames<DefForKey<S, K>>}`
}[MethodKeys<S> & string]

/**
 * Flat typed map of all schema defs and operations.
 * Every key is a SchemaDefs<S> string, every value is the same string (identity).
 *
 * - `refs.Author` → `'Author'`
 * - `refs['Author.deactivate']` → `'Author.deactivate'`
 * - `refs.wrote` → `'wrote'`
 *
 * All values are plain strings — usable directly as computed keys and index values.
 */
export type SchemaDefsMap<S extends Schema> = {
  readonly [K in SchemaDefs<S>]: K
}

// ── Data types ──────────────────────────────────────────────────────────────

export interface Ref<D = unknown> {
  readonly __ref: true
  readonly __def: D
  readonly __id: string
}

export interface CoreInstance<N extends NodeDef = NodeDef> {
  readonly __kind: 'core-instance'
  readonly __nodeDef: N
  readonly __data: Record<string, unknown>
}

export interface CoreLink {
  readonly __kind: 'core-link'
  readonly __from: CoreInstance | Ref
  readonly __to: CoreInstance | Ref
  readonly __edge: string
  readonly __data?: Record<string, unknown>
}

export type RefsFromInstances<Nodes extends Record<string, CoreInstance>> = {
  [K in keyof Nodes]: Nodes[K] extends CoreInstance<infer N> ? Ref<N> : never
}

export interface CoreDef<
  S extends Schema = Schema,
  N extends string = string,
  R extends Record<string, Ref> = Record<string, Ref>,
> {
  readonly schema: S
  readonly namespace: N
  readonly refs: R
  readonly __operations: ReadonlyArray<{ type: 'create' | 'link'; args: unknown[] }>
}

export interface SeedDef<
  S extends Schema = Schema,
  C extends CoreDef = CoreDef,
  R extends Record<string, Ref> = Record<string, Ref>,
> {
  readonly schema: S
  readonly core: C
  readonly refs: R
  readonly __operations: ReadonlyArray<{ type: 'create' | 'link'; args: unknown[] }>
}
