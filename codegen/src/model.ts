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
} from '@astrale/kernel-compiler'

// ─── Graph Model (enriched, indexed) ────────────────────────

import type { IRAttribute, Endpoint, EdgeConstraints, ValueConstraints } from '@astrale/kernel-compiler'

export interface GraphModel {
  scalars: string[]
  aliases: Map<string, ResolvedAlias>
  nodeDefs: Map<string, ResolvedNode>
  edgeDefs: Map<string, ResolvedEdge>
  extensions: { uri: string; importedTypes: string[] }[]
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
  origin?: string
}

export interface ResolvedEdge {
  name: string
  endpoints: Endpoint[]
  ownAttributes: IRAttribute[]
  allAttributes: IRAttribute[]
  constraints: EdgeConstraints
  origin?: string
}
