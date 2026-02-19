// src/ast.ts
// ============================================================
// Abstract Syntax Tree — Semantic
//
// Produced by the lowering pass (CST → AST). This is what the
// resolver and validator operate on.
//
// Differences from CST:
//   - No trivia, no punctuation tokens
//   - Desugared: class with signature → EdgeDecl
//   - Separate NodeDecl (node) and EdgeDecl (edge)
//   - Type expressions are structured, not token-level
//   - Every node carries a Span for diagnostics
// ============================================================

import { type Span } from '../tokens'

// --- Base ---

export interface AstNode {
  span: Span
}

// --- Top Level ---

export interface Schema extends AstNode {
  declarations: Declaration[]
}

export type Declaration =
  | TypeAliasDecl
  | ValueTypeDecl
  | TaggedUnionDecl
  | InterfaceDecl
  | NodeDecl
  | EdgeDecl
  | DataDecl
  | ExtendDecl

// --- Type Alias ---
// type Email = String [format: email]

export interface TypeAliasDecl extends AstNode {
  kind: 'TypeAliasDecl'
  name: Name
  type: TypeExpr
  modifiers: Modifier[]
}

// --- Value Type ---
// type Coordinates = { lat: Float, lng: Float }

export interface ValueTypeDecl extends AstNode {
  kind: 'ValueTypeDecl'
  name: Name
  fields: ValueTypeField[]
}

export interface ValueTypeField extends AstNode {
  name: Name
  type: TypeExpr
  nullable: boolean
  list: boolean
  defaultValue: Expression | null
}

// --- Tagged Union ---
// type PublicKey = | jwk { key: String } | jwksUri { uri: String }

export interface TaggedUnionDecl extends AstNode {
  kind: 'TaggedUnionDecl'
  name: Name
  variants: TaggedUnionVariant[]
}

export interface TaggedUnionVariant extends AstNode {
  tag: string
  fields: ValueTypeField[]
}

// --- Interface ---
// interface Timestamped : Foo, Bar { ... }

export interface InterfaceDecl extends AstNode {
  kind: 'InterfaceDecl'
  name: Name
  extends: Name[]
  attributes: Attribute[]
  methods: Method[]
  dataDecl: DataDecl | null
  dataRef: Name | null
}

// --- Node ---
// class User : Identity, Timestamped { ... }

export interface NodeDecl extends AstNode {
  kind: 'NodeDecl'
  name: Name
  implements: Name[]
  modifiers: Modifier[]
  attributes: Attribute[]
  methods: Method[]
  dataDecl: DataDecl | null
  dataRef: Name | null
}

// --- Edge ---
// class follows(follower: User, followee: User) [no_self, unique] { ... }
// Split from NodeDecl during lowering (CST ClassDecl with signature → AST EdgeDecl).

export interface EdgeDecl extends AstNode {
  kind: 'EdgeDecl'
  name: Name
  params: Param[]
  implements: Name[]
  modifiers: Modifier[]
  attributes: Attribute[]
  methods: Method[]
  dataDecl: DataDecl | null
  dataRef: Name | null
}

// --- Data ---
// data OperationData = { paramsSchema: String, ... }
// data Payload = Bytes

export interface DataDecl extends AstNode {
  kind: 'DataDecl'
  name: Name
  fields: ValueTypeField[] | null
  scalarType: TypeExpr | null
}

// --- Extend ---
// extend "https://kernel.astrale.ai/v1" { Identity }

export interface ExtendDecl extends AstNode {
  kind: 'ExtendDecl'
  uri: string
  imports: Name[]
}

// --- Components ---

export interface Param extends AstNode {
  name: Name
  type: TypeExpr
}

export interface Attribute extends AstNode {
  name: Name
  type: TypeExpr
  modifiers: Modifier[]
  defaultValue: Expression | null
}

export interface Method extends AstNode {
  kind: 'Method'
  name: Name
  access: 'public' | 'private'
  params: MethodParam[]
  returnType: TypeExpr
  returnList: boolean
  returnNullable: boolean
  projection: Projection | null
}

export interface Projection extends AstNode {
  star: boolean
  fields: Name[]
  dataRef: Name | null
}

export interface MethodParam extends AstNode {
  name: Name
  type: TypeExpr
  defaultValue: Expression | null
}

// --- Names ---
// A name is an identifier with a span, used for everything
// that the resolver needs to look up.

export interface Name extends AstNode {
  value: string
}

// --- Type Expressions ---

export type TypeExpr = NamedType | NullableType | UnionType | EdgeRefType

export interface NamedType extends AstNode {
  kind: 'NamedType'
  name: Name
}

export interface NullableType extends AstNode {
  kind: 'NullableType'
  inner: TypeExpr
}

export interface UnionType extends AstNode {
  kind: 'UnionType'
  types: TypeExpr[]
}

export interface EdgeRefType extends AstNode {
  kind: 'EdgeRefType'
  /** Named edge type, or null for edge<any>. */
  target: Name | null
}

// --- Modifiers ---
// The AST classifies modifiers into concrete types.
// The CST has a uniform Modifier node; the lowering pass
// interprets the children and produces these.

export type Modifier =
  | FlagModifier
  | FormatModifier
  | MatchModifier
  | InModifier
  | LengthModifier
  | IndexedModifier
  | CardinalityModifier
  | RangeModifier
  | LifecycleModifier

export interface FlagModifier extends AstNode {
  kind: 'FlagModifier'
  flag: 'no_self' | 'acyclic' | 'unique' | 'symmetric' | 'readonly' | 'indexed'
}

export interface FormatModifier extends AstNode {
  kind: 'FormatModifier'
  format: string // "email", "url", "uuid", "slug", "phone"
}

export interface MatchModifier extends AstNode {
  kind: 'MatchModifier'
  pattern: string
}

export interface InModifier extends AstNode {
  kind: 'InModifier'
  values: string[]
}

export interface LengthModifier extends AstNode {
  kind: 'LengthModifier'
  min: number
  max: number
}

export interface IndexedModifier extends AstNode {
  kind: 'IndexedModifier'
  direction: 'asc' | 'desc'
}

export interface CardinalityModifier extends AstNode {
  kind: 'CardinalityModifier'
  /** The parameter name this constraint applies to. */
  param: Name
  min: number
  /** null = unbounded (*) */
  max: number | null
}

export interface RangeModifier extends AstNode {
  kind: 'RangeModifier'
  operator: '>=' | '<=' | '..'
  min: number | null
  max: number | null
}

export interface LifecycleModifier extends AstNode {
  kind: 'LifecycleModifier'
  event: 'on_kill_source' | 'on_kill_target'
  action: 'cascade' | 'unlink' | 'prevent'
}

// --- Expressions ---

export type Expression =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | NullLiteral
  | CallExpression

export interface StringLiteral extends AstNode {
  kind: 'StringLiteral'
  value: string
}

export interface NumberLiteral extends AstNode {
  kind: 'NumberLiteral'
  value: number
}

export interface BooleanLiteral extends AstNode {
  kind: 'BooleanLiteral'
  value: boolean
}

export interface NullLiteral extends AstNode {
  kind: 'NullLiteral'
}

export interface CallExpression extends AstNode {
  kind: 'CallExpression'
  fn: Name
}
