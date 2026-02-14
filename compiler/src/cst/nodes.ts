// src/cst.ts
// ============================================================
// Concrete Syntax Tree — Lossless
//
// Mirrors the grammar productions exactly. No desugaring.
// Every token is preserved (tokens carry their own trivia).
//
// The CST is what the parser produces. The lowering pass
// (cst → ast) desugars and discards syntactic noise.
//
// Design:
//   - Each node has typed fields for semantic children
//   - Each node has a `children` array with ALL tokens/nodes
//     in source order (for formatting, range computation, LSP)
//   - Tokens in typed fields are also in `children`
//   - Span is computed lazily from first/last child
// ============================================================

import { type Token, type Span } from '../tokens'

// --- Base ---

export type CstChild = Token | CstNode

export interface CstNode {
  kind: CstNodeKind
  children: CstChild[]
}

export type CstNodeKind =
  | 'Schema'
  | 'TypeAliasDecl'
  | 'InterfaceDecl'
  | 'ClassDecl'
  | 'ExtendDecl'
  | 'ExtendsClause'
  | 'IdentList'
  | 'Signature'
  | 'Param'
  | 'Body'
  | 'Attribute'
  | 'DefaultValue'
  | 'Expression'
  | 'TypeExpr'
  | 'UnionType'
  | 'NullableType'
  | 'NamedType'
  | 'EdgeRefType'
  | 'ModifierList'
  | 'Modifier'
  | 'CardinalityBound'
  | 'Range'
  | 'StringList'

// --- Typed CST Nodes ---
// These extend CstNode with named accessors for semantic children.
// The `children` array still holds everything in source order.

export interface SchemaNode extends CstNode {
  kind: 'Schema'
  declarations: DeclarationNode[]
  eof: Token
}

export type DeclarationNode = TypeAliasDeclNode | InterfaceDeclNode | ClassDeclNode | ExtendDeclNode

// type Name = TypeExpr [modifiers]
export interface TypeAliasDeclNode extends CstNode {
  kind: 'TypeAliasDecl'
  typeKeyword: Token // "type"
  name: Token // Ident
  eq: Token // =
  typeExpr: TypeExprNode
  modifiers: ModifierListNode | null
}

// interface Name : Parents { body }
export interface InterfaceDeclNode extends CstNode {
  kind: 'InterfaceDecl'
  interfaceKeyword: Token // "interface"
  name: Token // Ident
  extendsClause: ExtendsClauseNode | null
  body: BodyNode | null
}

// class Name(sig)? : Parents [mods] { body }
// Unified: edge vs node is determined by presence of signature.
// The lowering pass splits this into NodeDecl / EdgeDecl in the AST.
export interface ClassDeclNode extends CstNode {
  kind: 'ClassDecl'
  classKeyword: Token // "class"
  name: Token // Ident
  signature: SignatureNode | null
  extendsClause: ExtendsClauseNode | null
  modifiers: ModifierListNode | null
  body: BodyNode | null
}

// extend "uri" { Ident, Ident }
export interface ExtendDeclNode extends CstNode {
  kind: 'ExtendDecl'
  extendKeyword: Token // "extend"
  uri: Token // StringLit
  lbrace: Token
  imports: IdentListNode
  rbrace: Token
}

// --- Shared Components ---

// : Ident, Ident, ...
export interface ExtendsClauseNode extends CstNode {
  kind: 'ExtendsClause'
  colon: Token
  names: IdentListNode
}

// Ident (, Ident)*
export interface IdentListNode extends CstNode {
  kind: 'IdentList'
  /** Identifier tokens (commas are in `children` but not here). */
  items: Token[]
}

// ( Param, Param, ... )
export interface SignatureNode extends CstNode {
  kind: 'Signature'
  lparen: Token
  params: ParamNode[]
  rparen: Token
}

// name : TypeExpr
export interface ParamNode extends CstNode {
  kind: 'Param'
  name: Token
  colon: Token
  typeExpr: TypeExprNode
}

// { Attribute* }
export interface BodyNode extends CstNode {
  kind: 'Body'
  lbrace: Token
  attributes: AttributeNode[]
  rbrace: Token
}

// name : TypeExpr [mods] = default
export interface AttributeNode extends CstNode {
  kind: 'Attribute'
  name: Token
  colon: Token
  typeExpr: TypeExprNode
  modifiers: ModifierListNode | null
  defaultValue: DefaultValueNode | null
}

// = Expression
export interface DefaultValueNode extends CstNode {
  kind: 'DefaultValue'
  eq: Token
  expression: ExpressionNode
}

// --- Type Expressions ---
// These nest: TypeExpr → UnionType → NullableType → PrimaryType

export type TypeExprNode = UnionTypeNode | NullableTypeNode | PrimaryTypeNode

// A | B | C
export interface UnionTypeNode extends CstNode {
  kind: 'UnionType'
  /** The constituent types (pipes are in `children`). */
  types: (NullableTypeNode | PrimaryTypeNode)[]
}

// Type?
export interface NullableTypeNode extends CstNode {
  kind: 'NullableType'
  inner: PrimaryTypeNode
  question: Token
}

// Ident  or  edge<Target>
export type PrimaryTypeNode = NamedTypeNode | EdgeRefTypeNode

export interface NamedTypeNode extends CstNode {
  kind: 'NamedType'
  name: Token // Ident
}

export interface EdgeRefTypeNode extends CstNode {
  kind: 'EdgeRefType'
  edgeKeyword: Token // "edge"
  langle: Token
  target: Token // Ident or "any"
  rangle: Token
}

// --- Modifier List ---

// [ Modifier, Modifier, ... ]
export interface ModifierListNode extends CstNode {
  kind: 'ModifierList'
  lbracket: Token
  modifiers: ModifierNode[]
  rbracket: Token
}

// Covers all modifier variants uniformly.
// The parser distinguishes:
//   flag:         no_self
//   kv:           format: email
//   cardinality:  child -> 0..1
//   range:        >= 5
//   lifecycle:    on_kill_source: cascade
//
// But in the CST they're all `Modifier` with varying children.
export interface ModifierNode extends CstNode {
  kind: 'Modifier'
  // First token is always the modifier name/key (Ident or operator).
  // Remaining children vary by modifier type.
  // The lowering pass classifies them.
}

// N..M or N..*
export interface CardinalityBoundNode extends CstNode {
  kind: 'CardinalityBound'
  // Children: NumberLit [DotDot (NumberLit | Star)]
}

// N..M (in kv modifiers like length: 1..255)
export interface RangeNode extends CstNode {
  kind: 'Range'
  // Children: NumberLit DotDot NumberLit
}

// ["a", "b", "c"]
export interface StringListNode extends CstNode {
  kind: 'StringList'
  lbracket: Token
  values: Token[] // StringLit tokens
  rbracket: Token
}

// --- Expressions ---

export type ExpressionNode = LiteralExprNode | CallExprNode

export interface LiteralExprNode extends CstNode {
  kind: 'Expression'
  /** StringLit, NumberLit, or Ident ("true"/"false"/"null") */
  token: Token
}

export interface CallExprNode extends CstNode {
  kind: 'Expression'
  fn: Token // Ident
  lparen: Token
  rparen: Token
}

// --- Utilities ---

export function isToken(child: CstChild): child is Token {
  return 'text' in child
}

export function isNode(child: CstChild): child is CstNode {
  return 'children' in child
}

/** Compute span of a CST node from its children. */
export function spanOf(node: CstNode): Span {
  const first = firstToken(node)
  const last = lastToken(node)
  return {
    start: first?.span.start ?? 0,
    end: last?.span.end ?? 0,
  }
}

function firstToken(node: CstNode): Token | undefined {
  for (const child of node.children) {
    if (isToken(child)) return child
    const t = firstToken(child)
    if (t) return t
  }
  return undefined
}

function lastToken(node: CstNode): Token | undefined {
  for (let i = node.children.length - 1; i >= 0; i--) {
    const child = node.children[i]
    if (isToken(child)) return child
    const t = lastToken(child)
    if (t) return t
  }
  return undefined
}
