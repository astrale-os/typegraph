// src/model.ts
// ============================================================
// Graph Model — Enriched, indexed representation of the IR
//
// The Loader builds this from one or more SchemaIR inputs.
// All emitters consume this — never raw IR.
// ============================================================

// IR types re-exported from the compiler (single source of truth)
export type {
  SchemaIR,
  ClassDef,
  NodeDef,
  EdgeDef,
  IRAttribute,
  Endpoint,
  EdgeConstraints,
  ValueConstraints,
  AttributeModifiers,
  TypeRef,
  ValueNode,
  MethodDef,
  MethodParam,
  MethodProjection,
  ValueTypeDef,
  ValueTypeField,
  TaggedUnionDef,
  TaggedUnionVariant,
  DataTypeDef,
} from '@astrale/kernel-compiler'

// ─── Graph Model (enriched, indexed) ────────────────────────

import type {
  IRAttribute,
  Endpoint,
  EdgeConstraints,
  ValueConstraints,
  MethodDef,
  ValueTypeField,
  TaggedUnionVariant,
} from '@astrale/kernel-compiler'

export interface GraphModel {
  scalars: string[]
  aliases: Map<string, ResolvedAlias>
  valueTypes: Map<string, ResolvedValueType>
  taggedUnions: Map<string, ResolvedTaggedUnion>
  dataTypes: Map<string, ResolvedDataType>
  nodeDefs: Map<string, ResolvedNode>
  edgeDefs: Map<string, ResolvedEdge>
  extensions: { uri: string; importedTypes: string[] }[]
}

export interface ResolvedValueType {
  name: string
  fields: ValueTypeField[]
}

export interface ResolvedTaggedUnion {
  name: string
  variants: TaggedUnionVariant[]
}

export interface ResolvedDataType {
  name: string
  fields: ValueTypeField[] | null
  scalarType: string | null
}

export interface ResolvedAlias {
  name: string
  underlyingType: string
  constraints: ValueConstraints | null
  isEnum: boolean
  enumValues: string[] | null
}

export interface ResolvedNode {
  name: string
  abstract: boolean
  implements: string[]
  ownAttributes: IRAttribute[]
  /** Own + inherited, parents-first. Own attrs override inherited by name. */
  allAttributes: IRAttribute[]
  ownMethods: MethodDef[]
  allMethods: MethodDef[]
  dataRef?: string
}

export interface ResolvedEdge {
  name: string
  endpoints: Endpoint[]
  ownAttributes: IRAttribute[]
  allAttributes: IRAttribute[]
  ownMethods: MethodDef[]
  allMethods: MethodDef[]
  constraints: EdgeConstraints
  dataRef?: string
}
