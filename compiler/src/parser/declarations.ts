// parser/declarations.ts
// ============================================================
// Declaration Parsing
//
// type, interface, class, extend declarations and their
// shared components (extends clause, signatures, params,
// body, attributes, default values).
// ============================================================

import { type Token } from '../tokens.js'
import {
  type CstChild,
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
  type ModifierListNode,
} from '../cst/index.js'
import { DiagnosticCodes } from '../diagnostics.js'
import { type ParserContext, isDeclStart } from './index.js'
import { parseTypeExpr } from './types.js'
import { parseModifierList } from './modifiers.js'
import { parseExpression } from './expressions.js'

// --- Declaration dispatch ---

export function parseDeclaration(p: ParserContext): DeclarationNode | null {
  if (p.atKeyword('type')) return parseTypeAlias(p)
  if (p.atKeyword('interface')) return parseInterface(p)
  if (p.atKeyword('class')) return parseClass(p)
  if (p.atKeyword('extend')) return parseExtend(p)

  p.diagnostics.error(
    p.current().span,
    DiagnosticCodes.P_EXPECTED_DECLARATION,
    `Expected declaration (type, interface, class, extend), got '${p.current().text}'`,
  )
  return null
}

// --- type Name = TypeExpr [modifiers] ---

function parseTypeAlias(p: ParserContext): TypeAliasDeclNode {
  const children: CstChild[] = []

  const typeKeyword = p.expectKeyword('type')
  children.push(typeKeyword)

  const name = p.expectIdent()
  children.push(name)

  const eq = p.expect('Eq')
  children.push(eq)

  const typeExpr = parseTypeExpr(p)
  children.push(typeExpr)

  let modifiers: ModifierListNode | null = null
  if (p.at('LBracket')) {
    modifiers = parseModifierList(p)
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

// --- interface Name : Parents { body } ---

function parseInterface(p: ParserContext): InterfaceDeclNode {
  const children: CstChild[] = []

  const interfaceKeyword = p.expectKeyword('interface')
  children.push(interfaceKeyword)

  const name = p.expectIdent()
  children.push(name)

  let extendsClause: ExtendsClauseNode | null = null
  if (p.at('Colon')) {
    extendsClause = parseExtendsClause(p)
    children.push(extendsClause)
  }

  let body: BodyNode | null = null
  if (p.at('LBrace')) {
    body = parseBody(p)
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

// --- class Name(sig)? : Parents [mods] { body } ---

function parseClass(p: ParserContext): ClassDeclNode {
  const children: CstChild[] = []

  const classKeyword = p.expectKeyword('class')
  children.push(classKeyword)

  const name = p.expectIdent()
  children.push(name)

  // Lookahead: if next token is '(' → edge signature
  let signature: SignatureNode | null = null
  if (p.at('LParen')) {
    signature = parseSignature(p)
    children.push(signature)
  }

  let extendsClause: ExtendsClauseNode | null = null
  if (p.at('Colon')) {
    extendsClause = parseExtendsClause(p)
    children.push(extendsClause)
  }

  let modifiers: ModifierListNode | null = null
  if (p.at('LBracket')) {
    modifiers = parseModifierList(p)
    children.push(modifiers)
  }

  let body: BodyNode | null = null
  if (p.at('LBrace')) {
    body = parseBody(p)
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

// --- extend "uri" { Ident, Ident } ---

function parseExtend(p: ParserContext): ExtendDeclNode {
  const children: CstChild[] = []

  const extendKeyword = p.expectKeyword('extend')
  children.push(extendKeyword)

  const uri = p.expect('StringLit')
  children.push(uri)

  const lbrace = p.expect('LBrace')
  children.push(lbrace)

  const imports = parseIdentList(p)
  children.push(imports)

  const rbrace = p.expect('RBrace')
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
function parseExtendsClause(p: ParserContext): ExtendsClauseNode {
  const children: CstChild[] = []

  const colon = p.expect('Colon')
  children.push(colon)

  const names = parseIdentList(p)
  children.push(names)

  return {
    kind: 'ExtendsClause',
    children,
    colon,
    names,
  }
}

// Ident (, Ident)*
function parseIdentList(p: ParserContext): IdentListNode {
  const children: CstChild[] = []
  const items: Token[] = []

  const first = p.expectIdent()
  children.push(first)
  items.push(first)

  while (p.at('Comma')) {
    const comma = p.advance()
    children.push(comma)
    const ident = p.expectIdent()
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
function parseSignature(p: ParserContext): SignatureNode {
  const children: CstChild[] = []

  const lparen = p.expect('LParen')
  children.push(lparen)

  const params: ParamNode[] = []

  if (!p.at('RParen') && !p.at('EOF')) {
    const first = parseParam(p)
    params.push(first)
    children.push(first)

    while (p.at('Comma')) {
      const comma = p.advance()
      children.push(comma)
      const param = parseParam(p)
      params.push(param)
      children.push(param)
    }
  }

  const rparen = p.expect('RParen')
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
function parseParam(p: ParserContext): ParamNode {
  const children: CstChild[] = []

  const name = p.expectIdent()
  children.push(name)

  const colon = p.expect('Colon')
  children.push(colon)

  const typeExpr = parseTypeExpr(p)
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
function parseBody(p: ParserContext): BodyNode {
  const children: CstChild[] = []

  const lbrace = p.expect('LBrace')
  children.push(lbrace)

  const attributes: AttributeNode[] = []

  while (!p.at('RBrace') && !p.at('EOF')) {
    // If we see a declaration keyword or EOF, the body is probably missing its closing brace.
    if (isDeclStart(p.current())) {
      p.diagnostics.error(
        p.current().span,
        DiagnosticCodes.P_UNCLOSED_BRACE,
        "Unclosed '{'",
      )
      break
    }

    const attr = parseAttribute(p)
    if (attr) {
      attributes.push(attr)
      children.push(attr)
    } else {
      // Recovery within body: skip one token
      const skipped = p.advance()
      children.push(skipped)
    }
  }

  const rbrace = p.expect('RBrace')
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
function parseAttribute(p: ParserContext): AttributeNode | null {
  if (!p.at('Ident')) return null

  // Lookahead: must be `Ident Colon` to be an attribute
  if (p.peek(1).kind !== 'Colon') return null

  const children: CstChild[] = []

  const name = p.advance() // Ident
  children.push(name)

  const colon = p.expect('Colon')
  children.push(colon)

  const typeExpr = parseTypeExpr(p)
  children.push(typeExpr)

  let modifiers: ModifierListNode | null = null
  if (p.at('LBracket')) {
    modifiers = parseModifierList(p)
    children.push(modifiers)
  }

  let defaultValue: DefaultValueNode | null = null
  if (p.at('Eq')) {
    defaultValue = parseDefaultValue(p)
    children.push(defaultValue)
  }

  // Optional trailing comma between attributes
  if (p.at('Comma')) {
    children.push(p.advance())
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
function parseDefaultValue(p: ParserContext): DefaultValueNode {
  const children: CstChild[] = []

  const eq = p.expect('Eq')
  children.push(eq)

  const expression = parseExpression(p)
  children.push(expression)

  return {
    kind: 'DefaultValue',
    children,
    eq,
    expression,
  }
}
