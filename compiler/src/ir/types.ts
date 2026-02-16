// src/ir.ts
// ============================================================
// Schema IR — TypeScript Definitions
//
// Single `classes` array with discriminator `type: "node" | "edge"`.
// Interfaces are nodes with `abstract: true`.
// ============================================================

export interface SchemaIR {
  version: '1.0'
  meta: {
    generated_at: string
    source_hash: string
  }
  extensions: Extension[]
  builtin_scalars: string[]
  type_aliases: TypeAlias[]
  value_types: ValueTypeDef[]
  classes: ClassDef[]
}

export interface Extension {
  uri: string
  imported_types: string[]
}

export interface TypeAlias {
  name: string
  underlying_type: string
  constraints: ValueConstraints | null
}

// --- Value Type Definitions ---

export interface ValueTypeDef {
  name: string
  fields: ValueTypeField[]
}

export interface ValueTypeField {
  name: string
  type: TypeRef
  nullable: boolean
  default: ValueNode | null
}

// --- Class Definitions (discriminated on `type`) ---

export type ClassDef = NodeDef | EdgeDef

export interface NodeDef {
  type: 'node'
  name: string
  abstract: boolean
  implements: string[]
  attributes: IRAttribute[]
  methods: MethodDef[]
  origin?: string
}

export interface EdgeDef {
  type: 'edge'
  name: string
  endpoints: Endpoint[]
  attributes: IRAttribute[]
  methods: MethodDef[]
  constraints: EdgeConstraints
  origin?: string
}

export interface Endpoint {
  param_name: string
  allowed_types: TypeRef[]
  cardinality: Cardinality | null
}

export interface Cardinality {
  min: number
  /** null = unbounded */
  max: number | null
}

export interface EdgeConstraints {
  no_self: boolean
  acyclic: boolean
  unique: boolean
  symmetric: boolean
  on_kill_source?: LifecycleAction
  on_kill_target?: LifecycleAction
}

export type LifecycleAction = 'cascade' | 'unlink' | 'prevent'

export interface IRAttribute {
  name: string
  type: TypeRef
  nullable: boolean
  default: ValueNode | null
  value_constraints?: ValueConstraints | null
  modifiers: AttributeModifiers
}

// --- TypeRef (discriminated) ---

export type TypeRef =
  | { kind: 'Scalar'; name: string }
  | { kind: 'Node'; name: string }
  | { kind: 'Alias'; name: string }
  | { kind: 'Edge'; name: string }
  | { kind: 'AnyEdge' }
  | { kind: 'Union'; types: TypeRef[] }
  | { kind: 'ValueType'; name: string }
  | { kind: 'List'; element: TypeRef }

// --- ValueNode (structured defaults) ---

export type ValueNode =
  | { kind: 'StringLiteral'; value: string }
  | { kind: 'NumberLiteral'; value: number }
  | { kind: 'BooleanLiteral'; value: boolean }
  | { kind: 'Null' }
  | { kind: 'Call'; fn: string; args: ValueNode[] }

// --- Method Definitions ---

export interface MethodDef {
  name: string
  access: 'public' | 'private'
  params: MethodParam[]
  return_type: TypeRef
  return_nullable: boolean
}

export interface MethodParam {
  name: string
  type: TypeRef
  default: ValueNode | null
}

// --- Constraints & Modifiers ---

export interface ValueConstraints {
  format?: 'email' | 'url' | 'uuid' | 'slug' | 'phone'
  pattern?: string
  enum_values?: string[]
  length_min?: number
  length_max?: number
  value_min?: number
  value_max?: number
}

export interface AttributeModifiers {
  unique?: boolean
  readonly?: boolean
  indexed?: boolean | 'asc' | 'desc'
}
