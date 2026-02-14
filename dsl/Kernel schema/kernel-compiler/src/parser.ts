// src/parser.ts
// ============================================================
// Parser — Token Stream → Lossless CST
//
// Hand-rolled recursive descent. One token of lookahead.
// Produces a lossless CST: every token (including punctuation)
// is a child of some CST node.
//
// Error recovery uses panic mode: on unexpected tokens, skip
// forward to a synchronization point (declaration keywords,
// closing braces/brackets) and continue parsing.
// ============================================================

import { type Token, type TokenKind, isKeyword } from './tokens.js'
import {
  type CstChild,
  type SchemaNode,
  type DeclarationNode,
  type TypeAliasDeclNode,
  type InterfaceDeclNode,
  type ClassDeclNode,
  type ExtendDeclNode,
  type ExtendsClauseNode,
  type IdentListNode,
  type SignatureNode,
  type ParamNode,
  type BodyNode,
  type AttributeNode,
  type DefaultValueNode,
  type TypeExprNode,
  type UnionTypeNode,
  type NullableTypeNode,
  type NamedTypeNode,
  type EdgeRefTypeNode,
  type ModifierListNode,
  type ModifierNode,
  type StringListNode,
  type ExpressionNode,
  type LiteralExprNode,
  type CallExprNode,
} from './cst.js'
import { DiagnosticBag, DiagnosticCodes } from './diagnostics.js'

export interface ParseResult {
  cst: SchemaNode
  diagnostics: DiagnosticBag
}

export function parse(tokens: Token[], diagnostics?: DiagnosticBag): ParseResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const parser = new Parser(tokens, bag)
  const cst = parser.parseSchema()
  return { cst, diagnostics: bag }
}

// --- Sync tokens for error recovery ---

const DECL_KEYWORDS = ['class', 'interface', 'type', 'extend']

function isDeclStart(token: Token): boolean {
  return token.kind === 'Ident' && DECL_KEYWORDS.includes(token.text)
}

// ────────────────────────────────────────────────────────────

class Parser {
  private tokens: Token[]
  private pos: number = 0
  private diagnostics: DiagnosticBag

  constructor(tokens: Token[], diagnostics: DiagnosticBag) {
    this.tokens = tokens
    this.diagnostics = diagnostics
  }

  // --- Token access ---

  private current(): Token {
    return this.tokens[this.pos]
  }

  private peek(offset: number = 0): Token {
    const idx = this.pos + offset
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1] // EOF
  }

  private advance(): Token {
    const token = this.current()
    if (token.kind !== 'EOF') {
      this.pos++
    }
    return token
  }

  private at(kind: TokenKind): boolean {
    return this.current().kind === kind
  }

  private atKeyword(keyword: string): boolean {
    return isKeyword(this.current(), keyword)
  }

  /** Consume a token of the expected kind, or report error and return a synthetic token. */
  private expect(kind: TokenKind): Token {
    if (this.at(kind)) {
      return this.advance()
    }
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_TOKEN,
      `Expected ${kind}, got ${cur.kind}${cur.kind === 'Ident' ? ` '${cur.text}'` : ''}`,
    )
    // Return a synthetic zero-width token at current position
    return {
      kind,
      text: '',
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
  }

  /** Consume an Ident with specific text, or report error. */
  private expectKeyword(keyword: string): Token {
    if (this.atKeyword(keyword)) {
      return this.advance()
    }
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_TOKEN,
      `Expected '${keyword}', got ${cur.kind}${cur.kind === 'Ident' ? ` '${cur.text}'` : ''}`,
    )
    return {
      kind: 'Ident',
      text: keyword,
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
  }

  private expectIdent(): Token {
    if (this.at('Ident')) {
      return this.advance()
    }
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_TOKEN,
      `Expected identifier, got ${cur.kind}`,
    )
    return {
      kind: 'Ident',
      text: '<missing>',
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
  }

  // --- Error recovery ---

  /**
   * Panic mode: skip tokens until we hit a synchronization point.
   * Returns the skipped tokens (so they can be added to children
   * for lossless representation).
   */
  private skipToSync(): Token[] {
    const skipped: Token[] = []
    while (!this.at('EOF')) {
      if (isDeclStart(this.current())) break
      if (this.at('RBrace') || this.at('RBracket') || this.at('RParen')) break
      skipped.push(this.advance())
    }
    return skipped
  }

  // --- Schema (top-level) ---

  parseSchema(): SchemaNode {
    const children: CstChild[] = []
    const declarations: DeclarationNode[] = []

    while (!this.at('EOF')) {
      const decl = this.parseDeclaration()
      if (decl) {
        declarations.push(decl)
        children.push(decl)
      } else {
        // Recovery: skip to next declaration start
        const skipped = this.skipToSync()
        children.push(...skipped)
      }
    }

    const eof = this.advance() // EOF token
    children.push(eof)

    return {
      kind: 'Schema',
      children,
      declarations,
      eof,
    }
  }

  // --- Declarations ---

  private parseDeclaration(): DeclarationNode | null {
    if (this.atKeyword('type')) return this.parseTypeAlias()
    if (this.atKeyword('interface')) return this.parseInterface()
    if (this.atKeyword('class')) return this.parseClass()
    if (this.atKeyword('extend')) return this.parseExtend()

    this.diagnostics.error(
      this.current().span,
      DiagnosticCodes.P_EXPECTED_DECLARATION,
      `Expected declaration (type, interface, class, extend), got '${this.current().text}'`,
    )
    return null
  }

  // type Name = TypeExpr [modifiers]
  private parseTypeAlias(): TypeAliasDeclNode {
    const children: CstChild[] = []

    const typeKeyword = this.expectKeyword('type')
    children.push(typeKeyword)

    const name = this.expectIdent()
    children.push(name)

    const eq = this.expect('Eq')
    children.push(eq)

    const typeExpr = this.parseTypeExpr()
    children.push(typeExpr)

    let modifiers: ModifierListNode | null = null
    if (this.at('LBracket')) {
      modifiers = this.parseModifierList()
      children.push(modifiers)
    }

    return {
      kind: 'TypeAliasDecl',
      children,
      typeKeyword,
      name,
      eq,
      typeExpr,
      modifiers,
    }
  }

  // interface Name : Parents { body }
  private parseInterface(): InterfaceDeclNode {
    const children: CstChild[] = []

    const interfaceKeyword = this.expectKeyword('interface')
    children.push(interfaceKeyword)

    const name = this.expectIdent()
    children.push(name)

    let extendsClause: ExtendsClauseNode | null = null
    if (this.at('Colon')) {
      extendsClause = this.parseExtendsClause()
      children.push(extendsClause)
    }

    let body: BodyNode | null = null
    if (this.at('LBrace')) {
      body = this.parseBody()
      children.push(body)
    }

    return {
      kind: 'InterfaceDecl',
      children,
      interfaceKeyword,
      name,
      extendsClause,
      body,
    }
  }

  // class Name(sig)? : Parents [mods] { body }
  private parseClass(): ClassDeclNode {
    const children: CstChild[] = []

    const classKeyword = this.expectKeyword('class')
    children.push(classKeyword)

    const name = this.expectIdent()
    children.push(name)

    // Lookahead: if next token is '(' → edge signature
    let signature: SignatureNode | null = null
    if (this.at('LParen')) {
      signature = this.parseSignature()
      children.push(signature)
    }

    let extendsClause: ExtendsClauseNode | null = null
    if (this.at('Colon')) {
      extendsClause = this.parseExtendsClause()
      children.push(extendsClause)
    }

    let modifiers: ModifierListNode | null = null
    if (this.at('LBracket')) {
      modifiers = this.parseModifierList()
      children.push(modifiers)
    }

    let body: BodyNode | null = null
    if (this.at('LBrace')) {
      body = this.parseBody()
      children.push(body)
    }

    return {
      kind: 'ClassDecl',
      children,
      classKeyword,
      name,
      signature,
      extendsClause,
      modifiers,
      body,
    }
  }

  // extend "uri" { Ident, Ident }
  private parseExtend(): ExtendDeclNode {
    const children: CstChild[] = []

    const extendKeyword = this.expectKeyword('extend')
    children.push(extendKeyword)

    const uri = this.expect('StringLit')
    children.push(uri)

    const lbrace = this.expect('LBrace')
    children.push(lbrace)

    const imports = this.parseIdentList()
    children.push(imports)

    const rbrace = this.expect('RBrace')
    children.push(rbrace)

    return {
      kind: 'ExtendDecl',
      children,
      extendKeyword,
      uri,
      lbrace,
      imports,
      rbrace,
    }
  }

  // --- Shared Components ---

  // : Ident, Ident, ...
  private parseExtendsClause(): ExtendsClauseNode {
    const children: CstChild[] = []

    const colon = this.expect('Colon')
    children.push(colon)

    const names = this.parseIdentList()
    children.push(names)

    return {
      kind: 'ExtendsClause',
      children,
      colon,
      names,
    }
  }

  // Ident (, Ident)*
  private parseIdentList(): IdentListNode {
    const children: CstChild[] = []
    const items: Token[] = []

    const first = this.expectIdent()
    children.push(first)
    items.push(first)

    while (this.at('Comma')) {
      const comma = this.advance()
      children.push(comma)
      const ident = this.expectIdent()
      children.push(ident)
      items.push(ident)
    }

    return {
      kind: 'IdentList',
      children,
      items,
    }
  }

  // ( Param, Param, ... )
  private parseSignature(): SignatureNode {
    const children: CstChild[] = []

    const lparen = this.expect('LParen')
    children.push(lparen)

    const params: ParamNode[] = []

    if (!this.at('RParen') && !this.at('EOF')) {
      const first = this.parseParam()
      params.push(first)
      children.push(first)

      while (this.at('Comma')) {
        const comma = this.advance()
        children.push(comma)
        const param = this.parseParam()
        params.push(param)
        children.push(param)
      }
    }

    const rparen = this.expect('RParen')
    children.push(rparen)

    return {
      kind: 'Signature',
      children,
      lparen,
      params,
      rparen,
    }
  }

  // name : TypeExpr
  private parseParam(): ParamNode {
    const children: CstChild[] = []

    const name = this.expectIdent()
    children.push(name)

    const colon = this.expect('Colon')
    children.push(colon)

    const typeExpr = this.parseTypeExpr()
    children.push(typeExpr)

    return {
      kind: 'Param',
      children,
      name,
      colon,
      typeExpr,
    }
  }

  // { Attribute* }
  private parseBody(): BodyNode {
    const children: CstChild[] = []

    const lbrace = this.expect('LBrace')
    children.push(lbrace)

    const attributes: AttributeNode[] = []

    while (!this.at('RBrace') && !this.at('EOF')) {
      // If we see a declaration keyword or EOF, the body is probably missing its closing brace.
      if (isDeclStart(this.current())) {
        this.diagnostics.error(
          this.current().span,
          DiagnosticCodes.P_UNCLOSED_BRACE,
          "Unclosed '{'",
        )
        break
      }

      const attr = this.parseAttribute()
      if (attr) {
        attributes.push(attr)
        children.push(attr)
      } else {
        // Recovery within body: skip one token
        const skipped = this.advance()
        children.push(skipped)
      }
    }

    const rbrace = this.expect('RBrace')
    children.push(rbrace)

    return {
      kind: 'Body',
      children,
      lbrace,
      attributes,
      rbrace,
    }
  }

  // name : TypeExpr [mods] = default
  private parseAttribute(): AttributeNode | null {
    if (!this.at('Ident')) return null

    // Lookahead: must be `Ident Colon` to be an attribute
    if (this.peek(1).kind !== 'Colon') return null

    const children: CstChild[] = []

    const name = this.advance() // Ident
    children.push(name)

    const colon = this.expect('Colon')
    children.push(colon)

    const typeExpr = this.parseTypeExpr()
    children.push(typeExpr)

    let modifiers: ModifierListNode | null = null
    if (this.at('LBracket')) {
      modifiers = this.parseModifierList()
      children.push(modifiers)
    }

    let defaultValue: DefaultValueNode | null = null
    if (this.at('Eq')) {
      defaultValue = this.parseDefaultValue()
      children.push(defaultValue)
    }

    // Optional trailing comma between attributes
    if (this.at('Comma')) {
      children.push(this.advance())
    }

    return {
      kind: 'Attribute',
      children,
      name,
      colon,
      typeExpr,
      modifiers,
      defaultValue,
    }
  }

  // = Expression
  private parseDefaultValue(): DefaultValueNode {
    const children: CstChild[] = []

    const eq = this.expect('Eq')
    children.push(eq)

    const expression = this.parseExpression()
    children.push(expression)

    return {
      kind: 'DefaultValue',
      children,
      eq,
      expression,
    }
  }

  // --- Type Expressions ---

  private parseTypeExpr(): TypeExprNode {
    const first = this.parseNullableOrPrimary()

    // Check for union: Type | Type | ...
    if (this.at('Pipe')) {
      const children: CstChild[] = [first]
      const types: (NullableTypeNode | NamedTypeNode | EdgeRefTypeNode)[] = [
        first as NullableTypeNode | NamedTypeNode | EdgeRefTypeNode,
      ]

      while (this.at('Pipe')) {
        const pipe = this.advance()
        children.push(pipe)
        const next = this.parseNullableOrPrimary()
        children.push(next)
        types.push(next as NullableTypeNode | NamedTypeNode | EdgeRefTypeNode)
      }

      return {
        kind: 'UnionType',
        children,
        types,
      } as UnionTypeNode
    }

    return first
  }

  private parseNullableOrPrimary(): TypeExprNode {
    const primary = this.parsePrimaryType()

    if (this.at('Question')) {
      const question = this.advance()
      const children: CstChild[] = [primary, question]
      return {
        kind: 'NullableType',
        children,
        inner: primary,
        question,
      } as NullableTypeNode
    }

    return primary
  }

  private parsePrimaryType(): NamedTypeNode | EdgeRefTypeNode {
    // edge<Target>
    if (this.atKeyword('edge') && this.peek(1).kind === 'LAngle') {
      return this.parseEdgeRefType()
    }

    // Named type
    const name = this.expectIdent()
    return {
      kind: 'NamedType',
      children: [name],
      name,
    } as NamedTypeNode
  }

  private parseEdgeRefType(): EdgeRefTypeNode {
    const children: CstChild[] = []

    const edgeKeyword = this.advance() // "edge"
    children.push(edgeKeyword)

    const langle = this.expect('LAngle')
    children.push(langle)

    const target = this.expectIdent() // Ident or "any"
    children.push(target)

    const rangle = this.expect('RAngle')
    children.push(rangle)

    return {
      kind: 'EdgeRefType',
      children,
      edgeKeyword,
      langle,
      target,
      rangle,
    } as EdgeRefTypeNode
  }

  // --- Modifier List ---

  // [ Modifier, Modifier, ... ]
  private parseModifierList(): ModifierListNode {
    const children: CstChild[] = []

    const lbracket = this.expect('LBracket')
    children.push(lbracket)

    const modifiers: ModifierNode[] = []

    while (!this.at('RBracket') && !this.at('EOF')) {
      // Safety: break if we've hit a declaration start (missing `]`)
      if (isDeclStart(this.current())) {
        this.diagnostics.error(
          this.current().span,
          DiagnosticCodes.P_UNCLOSED_BRACKET,
          "Unclosed '['",
        )
        break
      }

      const mod = this.parseModifier()
      modifiers.push(mod)
      children.push(mod)

      if (this.at('Comma')) {
        const comma = this.advance()
        children.push(comma)
      } else if (!this.at('RBracket')) {
        // Not a comma and not closing — error but try to continue
        break
      }
    }

    const rbracket = this.expect('RBracket')
    children.push(rbracket)

    return {
      kind: 'ModifierList',
      children,
      lbracket,
      modifiers,
      rbracket,
    }
  }

  /**
   * Parse a single modifier. The CST doesn't classify them — the
   * lowering pass does that. We just collect tokens intelligently:
   *
   *   flag:         Ident                          (no_self, acyclic, ...)
   *   kv:           Ident Colon Value              (format: email)
   *   cardinality:  Ident Arrow Bound              (child -> 0..1)
   *   range:        GtEq/LtEq Number               (>= 5)
   *   lifecycle:    Ident Colon Ident              (on_kill_source: cascade)
   *   in:           Ident Colon [ StringList ]     (in: ["a", "b"])
   *   length:       Ident Colon Number..Number     (length: 1..255)
   */
  private parseModifier(): ModifierNode {
    const children: CstChild[] = []

    // Range modifiers: >= N, <= N
    if (this.at('GtEq') || this.at('LtEq')) {
      const op = this.advance()
      children.push(op)
      const num = this.expect('NumberLit')
      children.push(num)
      return { kind: 'Modifier', children }
    }

    // Everything else starts with Ident
    const name = this.expectIdent()
    children.push(name)

    // Cardinality: name -> bound
    if (this.at('Arrow')) {
      const arrow = this.advance()
      children.push(arrow)
      this.parseCardinalityBound(children)
      return { kind: 'Modifier', children }
    }

    // KV: name : value
    if (this.at('Colon')) {
      const colon = this.advance()
      children.push(colon)

      // in: [...]
      if (this.at('LBracket')) {
        const stringList = this.parseStringList()
        children.push(stringList)
        return { kind: 'Modifier', children }
      }

      // length: N..M  or  format: ident  or  lifecycle: action
      // Peek: if we have NumberLit followed by DotDot → range
      if (this.at('NumberLit') && this.peek(1).kind === 'DotDot') {
        const min = this.advance()
        children.push(min)
        const dotdot = this.advance()
        children.push(dotdot)
        const max = this.expect('NumberLit')
        children.push(max)
        return { kind: 'Modifier', children }
      }

      // Otherwise: Ident value (format: email, on_kill_source: cascade, indexed: asc)
      if (this.at('Ident')) {
        const value = this.advance()
        children.push(value)
        return { kind: 'Modifier', children }
      }

      // Fallback: number value
      if (this.at('NumberLit')) {
        const value = this.advance()
        children.push(value)
        return { kind: 'Modifier', children }
      }
    }

    // Standalone N..M (value range, e.g. 1..100 inside modifiers)
    if (this.at('DotDot')) {
      const dotdot = this.advance()
      children.push(dotdot)
      const max = this.expect('NumberLit')
      children.push(max)
      return { kind: 'Modifier', children }
    }

    // Bare flag: just the name
    return { kind: 'Modifier', children }
  }

  /** Parse cardinality bound: N, N..M, N..* */
  private parseCardinalityBound(children: CstChild[]): void {
    const num = this.expect('NumberLit')
    children.push(num)

    if (this.at('DotDot')) {
      const dotdot = this.advance()
      children.push(dotdot)

      if (this.at('Star')) {
        const star = this.advance()
        children.push(star)
      } else {
        const max = this.expect('NumberLit')
        children.push(max)
      }
    }
  }

  // ["a", "b", "c"]
  private parseStringList(): StringListNode {
    const children: CstChild[] = []
    const values: Token[] = []

    const lbracket = this.expect('LBracket')
    children.push(lbracket)

    if (!this.at('RBracket') && !this.at('EOF')) {
      const first = this.expect('StringLit')
      children.push(first)
      values.push(first)

      while (this.at('Comma')) {
        const comma = this.advance()
        children.push(comma)
        const str = this.expect('StringLit')
        children.push(str)
        values.push(str)
      }
    }

    const rbracket = this.expect('RBracket')
    children.push(rbracket)

    return {
      kind: 'StringList',
      children,
      lbracket,
      values,
      rbracket,
    }
  }

  // --- Expressions ---

  private parseExpression(): ExpressionNode {
    const children: CstChild[] = []

    // String literal
    if (this.at('StringLit')) {
      const token = this.advance()
      children.push(token)
      return { kind: 'Expression', children, token } as LiteralExprNode
    }

    // Number literal
    if (this.at('NumberLit')) {
      const token = this.advance()
      children.push(token)
      return { kind: 'Expression', children, token } as LiteralExprNode
    }

    // Ident: could be true, false, null, or fn()
    if (this.at('Ident')) {
      const ident = this.advance()
      children.push(ident)

      // Function call: name()
      if (this.at('LParen')) {
        const lparen = this.advance()
        children.push(lparen)
        const rparen = this.expect('RParen')
        children.push(rparen)
        return { kind: 'Expression', children, fn: ident, lparen, rparen } as CallExprNode
      }

      // true, false, null, or bare identifier (error but recoverable)
      return { kind: 'Expression', children, token: ident } as LiteralExprNode
    }

    // Error: unexpected token in expression position
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_EXPRESSION,
      `Expected expression, got ${cur.kind}`,
    )
    // Produce a synthetic literal
    const synthetic: Token = {
      kind: 'Ident',
      text: 'null',
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
    children.push(synthetic)
    return { kind: 'Expression', children, token: synthetic } as LiteralExprNode
  }
}
