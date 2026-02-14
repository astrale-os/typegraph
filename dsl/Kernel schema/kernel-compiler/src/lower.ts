// src/lower.ts
// ============================================================
// Lowering Pass — CST → AST
//
// Transforms the lossless CST into a clean semantic AST:
//   - Strips trivia and punctuation
//   - Splits ClassDeclNode → NodeDecl (node) or EdgeDecl (edge)
//   - Classifies uniform Modifier CST nodes into typed AST variants
//   - Resolves string literal values (strips quotes, unescapes)
//   - Converts number literal text to numbers
// ============================================================

import {
  type SchemaNode,
  type DeclarationNode,
  type ClassDeclNode,
  type InterfaceDeclNode,
  type TypeAliasDeclNode,
  type ExtendDeclNode,
  type AttributeNode,
  type ParamNode,
  type ModifierListNode,
  type ModifierNode,
  type TypeExprNode,
  type UnionTypeNode,
  type NullableTypeNode,
  type NamedTypeNode,
  type EdgeRefTypeNode,
  type ExpressionNode,
  type LiteralExprNode,
  type CallExprNode,
  type StringListNode,
  isToken,
} from './cst.js'
import {
  type Schema,
  type Declaration,
  type TypeAliasDecl,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type ExtendDecl,
  type Attribute,
  type Param,
  type Name,
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type EdgeRefType,
  type Modifier,
  type FlagModifier,
  type FormatModifier,
  type MatchModifier,
  type InModifier,
  type LengthModifier,
  type IndexedModifier,
  type CardinalityModifier,
  type LifecycleModifier,
  type Expression,
  type StringLiteral,
  type NumberLiteral,
  type BooleanLiteral,
  type NullLiteral,
  type CallExpression,
} from './ast.js'
import { type Token, type Span } from './tokens.js'
import { DiagnosticBag, DiagnosticCodes } from './diagnostics.js'
import { spanOf } from './cst.js'

export interface LowerResult {
  ast: Schema
  diagnostics: DiagnosticBag
}

export function lower(cst: SchemaNode, diagnostics?: DiagnosticBag): LowerResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const l = new Lowering(bag)
  const ast = l.lowerSchema(cst)
  return { ast, diagnostics: bag }
}

// ────────────────────────────────────────────────────────────

class Lowering {
  private diagnostics: DiagnosticBag

  constructor(diagnostics: DiagnosticBag) {
    this.diagnostics = diagnostics
  }

  // --- Schema ---

  lowerSchema(cst: SchemaNode): Schema {
    const declarations: Declaration[] = []
    for (const d of cst.declarations) {
      const lowered = this.lowerDeclaration(d)
      if (lowered) declarations.push(lowered)
    }
    return {
      declarations,
      span: spanOf(cst),
    }
  }

  // --- Declarations ---

  private lowerDeclaration(node: DeclarationNode): Declaration | null {
    switch (node.kind) {
      case 'TypeAliasDecl':
        return this.lowerTypeAlias(node)
      case 'InterfaceDecl':
        return this.lowerInterface(node)
      case 'ClassDecl':
        return this.lowerClass(node)
      case 'ExtendDecl':
        return this.lowerExtend(node)
      default:
        return null
    }
  }

  private lowerTypeAlias(node: TypeAliasDeclNode): TypeAliasDecl {
    return {
      kind: 'TypeAliasDecl',
      name: this.lowerName(node.name),
      type: this.lowerTypeExpr(node.typeExpr),
      modifiers: this.lowerModifiers(node.modifiers),
      span: spanOf(node),
    }
  }

  private lowerInterface(node: InterfaceDeclNode): InterfaceDecl {
    return {
      kind: 'InterfaceDecl',
      name: this.lowerName(node.name),
      extends: node.extendsClause
        ? node.extendsClause.names.items.map((t) => this.lowerName(t))
        : [],
      attributes: node.body ? node.body.attributes.map((a) => this.lowerAttribute(a)) : [],
      span: spanOf(node),
    }
  }

  private lowerClass(node: ClassDeclNode): NodeDecl | EdgeDecl {
    // Split: if signature is present → EdgeDecl, otherwise NodeDecl
    if (node.signature) {
      return this.lowerEdge(node)
    }
    return this.lowerNodeClass(node)
  }

  private lowerNodeClass(node: ClassDeclNode): NodeDecl {
    return {
      kind: 'NodeDecl',
      name: this.lowerName(node.name),
      implements: node.extendsClause
        ? node.extendsClause.names.items.map((t) => this.lowerName(t))
        : [],
      modifiers: this.lowerModifiers(node.modifiers),
      attributes: node.body ? node.body.attributes.map((a) => this.lowerAttribute(a)) : [],
      span: spanOf(node),
    }
  }

  private lowerEdge(node: ClassDeclNode): EdgeDecl {
    return {
      kind: 'EdgeDecl',
      name: this.lowerName(node.name),
      params: node.signature!.params.map((p) => this.lowerParam(p)),
      implements: node.extendsClause
        ? node.extendsClause.names.items.map((t) => this.lowerName(t))
        : [],
      modifiers: this.lowerModifiers(node.modifiers),
      attributes: node.body ? node.body.attributes.map((a) => this.lowerAttribute(a)) : [],
      span: spanOf(node),
    }
  }

  private lowerExtend(node: ExtendDeclNode): ExtendDecl {
    return {
      kind: 'ExtendDecl',
      uri: unquote(node.uri.text),
      imports: node.imports.items.map((t) => this.lowerName(t)),
      span: spanOf(node),
    }
  }

  // --- Components ---

  private lowerParam(node: ParamNode): Param {
    return {
      name: this.lowerName(node.name),
      type: this.lowerTypeExpr(node.typeExpr),
      span: spanOf(node),
    }
  }

  private lowerAttribute(node: AttributeNode): Attribute {
    return {
      name: this.lowerName(node.name),
      type: this.lowerTypeExpr(node.typeExpr),
      modifiers: this.lowerModifiers(node.modifiers),
      defaultValue: node.defaultValue ? this.lowerExpression(node.defaultValue.expression) : null,
      span: spanOf(node),
    }
  }

  private lowerName(token: Token): Name {
    return {
      value: token.text,
      span: token.span,
    }
  }

  // --- Type Expressions ---

  private lowerTypeExpr(node: TypeExprNode): TypeExpr {
    switch (node.kind) {
      case 'UnionType': {
        const union = node as UnionTypeNode
        return {
          kind: 'UnionType',
          types: union.types.map((t) => this.lowerTypeExpr(t)),
          span: spanOf(node),
        } as UnionType
      }
      case 'NullableType': {
        const nullable = node as NullableTypeNode
        return {
          kind: 'NullableType',
          inner: this.lowerTypeExpr(nullable.inner),
          span: spanOf(node),
        } as NullableType
      }
      case 'NamedType': {
        const named = node as NamedTypeNode
        return {
          kind: 'NamedType',
          name: this.lowerName(named.name),
          span: spanOf(node),
        } as NamedType
      }
      case 'EdgeRefType': {
        const edge = node as EdgeRefTypeNode
        return {
          kind: 'EdgeRefType',
          target: edge.target.text === 'any' ? null : this.lowerName(edge.target),
          span: spanOf(node),
        } as EdgeRefType
      }
    }
  }

  // --- Modifiers ---

  private lowerModifiers(list: ModifierListNode | null): Modifier[] {
    if (!list) return []
    return list.modifiers.map((m) => this.lowerModifier(m))
  }

  /**
   * Classify a CST Modifier into a typed AST variant.
   *
   * CST modifier children patterns:
   *   flag:         [Ident]                              → FlagModifier
   *   format:       [Ident("format"), Colon, Ident]      → FormatModifier
   *   match:        [Ident("match"), Colon, StringLit]   → MatchModifier
   *   in:           [Ident("in"), Colon, StringList]     → InModifier
   *   length:       [Ident("length"), Colon, N, .., M]   → LengthModifier
   *   indexed:      [Ident("indexed"), Colon, Ident]     → IndexedModifier
   *   cardinality:  [Ident, Arrow, N (.. M|*)?]          → CardinalityModifier
   *   range:        [GtEq|LtEq, NumberLit]               → RangeModifier
   *   lifecycle:    [Ident("on_kill_*"), Colon, Ident]   → LifecycleModifier
   */
  private lowerModifier(mod: ModifierNode): Modifier {
    const tokens = mod.children.filter(isToken)
    const span = spanOf(mod)

    // Empty (shouldn't happen, but be safe)
    if (tokens.length === 0) {
      return { kind: 'FlagModifier', flag: 'unique', span }
    }

    const first = tokens[0]

    // Range modifiers: >= N, <= N
    if (first.kind === 'GtEq' || first.kind === 'LtEq') {
      const value = tokens[1] ? parseNum(tokens[1].text, this.diagnostics, tokens[1].span) : 0
      if (first.kind === 'GtEq') {
        return { kind: 'RangeModifier', operator: '>=', min: value, max: null, span }
      } else {
        return { kind: 'RangeModifier', operator: '<=', min: null, max: value, span }
      }
    }

    // Everything else starts with Ident
    const name = first.text

    // Check for Arrow → cardinality
    if (tokens.length >= 3 && tokens[1].kind === 'Arrow') {
      return this.lowerCardinalityModifier(tokens, span)
    }

    // Check for Colon → kv modifier
    // Note: tokens.length may be 2 if the value is a CST node (e.g., StringList for `in:`)
    if (tokens.length >= 2 && tokens[1].kind === 'Colon') {
      return this.lowerKvModifier(name, tokens, mod, span)
    }

    // Standalone N..M after an Ident (name + DotDot + Number)
    if (tokens.length >= 3 && tokens[1].kind === 'DotDot') {
      const min = parseNum(first.text, this.diagnostics, first.span)
      const max = parseNum(tokens[2].text, this.diagnostics, tokens[2].span)
      return { kind: 'RangeModifier', operator: '..', min, max, span }
    }

    // Bare flag
    return this.lowerFlagModifier(name, span)
  }

  private lowerFlagModifier(name: string, span: Span): FlagModifier {
    const FLAGS = ['no_self', 'acyclic', 'unique', 'symmetric', 'readonly', 'indexed'] as const
    type FlagName = (typeof FLAGS)[number]
    if (FLAGS.includes(name as FlagName)) {
      return { kind: 'FlagModifier', flag: name as FlagName, span }
    }
    // Unknown flag — still emit, validator will catch it
    return { kind: 'FlagModifier', flag: name as any, span }
  }

  private lowerCardinalityModifier(tokens: Token[], span: Span): CardinalityModifier {
    const paramName = tokens[0]
    // tokens: [Ident, Arrow, NumberLit, (DotDot, NumberLit|Star)?]
    const min = parseNum(tokens[2].text, this.diagnostics, tokens[2].span)
    let max: number | null = min // default: exact

    if (tokens.length >= 5 && tokens[3].kind === 'DotDot') {
      if (tokens[4].kind === 'Star') {
        max = null // unbounded
      } else {
        max = parseNum(tokens[4].text, this.diagnostics, tokens[4].span)
      }
    }

    return {
      kind: 'CardinalityModifier',
      param: { value: paramName.text, span: paramName.span },
      min,
      max,
      span,
    }
  }

  private lowerKvModifier(name: string, tokens: Token[], mod: ModifierNode, span: Span): Modifier {
    switch (name) {
      case 'format':
        return {
          kind: 'FormatModifier',
          format: tokens[2].text,
          span,
        } as FormatModifier

      case 'match':
        return {
          kind: 'MatchModifier',
          pattern: unquote(tokens[2].text),
          span,
        } as MatchModifier

      case 'in': {
        // Find the StringList CST node in children
        const stringListNode = mod.children.find((c) => !isToken(c) && c.kind === 'StringList') as
          | StringListNode
          | undefined
        const values: string[] = []
        if (stringListNode) {
          for (const v of stringListNode.values) {
            values.push(unquote(v.text))
          }
        }
        return { kind: 'InModifier', values, span } as InModifier
      }

      case 'length': {
        // tokens: [Ident("length"), Colon, NumberLit, DotDot, NumberLit]
        const min = tokens[2] ? parseNum(tokens[2].text, this.diagnostics, tokens[2].span) : 0
        const max = tokens[4] ? parseNum(tokens[4].text, this.diagnostics, tokens[4].span) : min
        return { kind: 'LengthModifier', min, max, span } as LengthModifier
      }

      case 'indexed': {
        const dir = tokens[2].text
        if (dir === 'asc' || dir === 'desc') {
          return { kind: 'IndexedModifier', direction: dir, span } as IndexedModifier
        }
        // Fallback
        return { kind: 'IndexedModifier', direction: 'asc', span } as IndexedModifier
      }

      case 'on_kill_source':
      case 'on_kill_target': {
        const action = tokens[2].text as 'cascade' | 'unlink' | 'prevent'
        return {
          kind: 'LifecycleModifier',
          event: name as 'on_kill_source' | 'on_kill_target',
          action,
          span,
        } as LifecycleModifier
      }

      default:
        // Unknown kv modifier — treat as flag, validator will catch
        return this.lowerFlagModifier(name, span)
    }
  }

  // --- Expressions ---

  private lowerExpression(node: ExpressionNode): Expression {
    const span = spanOf(node)

    // CallExpression
    if ('fn' in node && 'lparen' in node) {
      const call = node as CallExprNode
      return {
        kind: 'CallExpression',
        fn: this.lowerName(call.fn),
        span,
      } as CallExpression
    }

    // Literal
    const lit = node as LiteralExprNode
    const token = lit.token

    if (token.kind === 'StringLit') {
      return {
        kind: 'StringLiteral',
        value: unquote(token.text),
        span,
      } as StringLiteral
    }

    if (token.kind === 'NumberLit') {
      return {
        kind: 'NumberLiteral',
        value: parseNum(token.text, this.diagnostics, token.span),
        span,
      } as NumberLiteral
    }

    // Ident: true, false, null
    if (token.text === 'true') {
      return { kind: 'BooleanLiteral', value: true, span } as BooleanLiteral
    }
    if (token.text === 'false') {
      return { kind: 'BooleanLiteral', value: false, span } as BooleanLiteral
    }
    if (token.text === 'null') {
      return { kind: 'NullLiteral', span } as NullLiteral
    }

    // Unknown identifier in expression position — treat as string
    return {
      kind: 'StringLiteral',
      value: token.text,
      span,
    } as StringLiteral
  }
}

// --- Utilities ---

/** Remove surrounding quotes and unescape. */
function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return s
}

/** Parse a number literal string. */
function parseNum(s: string, diagnostics: DiagnosticBag, span: Span): number {
  const value = Number(s)
  if (!Number.isFinite(value)) {
    diagnostics.error(span, DiagnosticCodes.L_INVALID_NUMBER, `Invalid number literal '${s}'`)
    return 0
  }
  return value
}
