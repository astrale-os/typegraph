// parser/declarations.ts
// ============================================================
// Declaration Parsing
//
// type, interface, class, extend declarations and their
// shared components (extends clause, signatures, params,
// body, attributes, default values).
// ============================================================

import {
  type CstChild,
  type DeclarationNode,
  type TypeAliasDeclNode,
  type ValueTypeDeclNode,
  type ValueTypeFieldNode,
  type TaggedUnionDeclNode,
  type VariantNode,
  type InterfaceDeclNode,
  type ClassDeclNode,
  type DataDeclNode,
  type DataRefNode,
  type ExtendDeclNode,
  type ExtendsClauseNode,
  type IdentListNode,
  type SignatureNode,
  type ParamNode,
  type BodyNode,
  type AttributeNode,
  type MethodNode,
  type MethodParamNode,
  type ProjectionNode,
  type NullableTypeNode,
  type DefaultValueNode,
  type ModifierListNode,
} from '../cst/index'
import { DiagnosticCodes } from '../diagnostics'
import { type Token } from '../tokens'
import { isKeyword } from '../tokens'
import { parseExpression } from './expressions'
import { type ParserContext, isDeclStart } from './index'
import { parseModifierList } from './modifiers'
import { parseTypeExpr } from './types'

// --- Declaration dispatch ---

export function parseDeclaration(p: ParserContext): DeclarationNode | null {
  if (p.atKeyword('type')) return parseTypeAlias(p)
  if (p.atKeyword('interface')) return parseInterface(p)
  if (p.atKeyword('class')) return parseClass(p)
  if (p.atKeyword('data')) return parseDataDecl(p)
  if (p.atKeyword('extend')) return parseExtend(p)

  p.diagnostics.error(
    p.current().span,
    DiagnosticCodes.P_EXPECTED_DECLARATION,
    `Expected declaration (type, interface, class, data, extend), got '${p.current().text}'`,
  )
  return null
}

// --- type Name = TypeExpr [modifiers]  or  type Name = { fields } ---

function parseTypeAlias(
  p: ParserContext,
): TypeAliasDeclNode | ValueTypeDeclNode | TaggedUnionDeclNode {
  const children: CstChild[] = []

  const typeKeyword = p.expectKeyword('type')
  children.push(typeKeyword)

  const name = p.expectIdent()
  children.push(name)

  const eq = p.expect('Eq')
  children.push(eq)

  // Branch: if next token is `|`, parse as tagged union
  if (p.at('Pipe')) {
    return parseTaggedUnion(p, children, typeKeyword, name, eq)
  }

  // Branch: if next token is `{`, parse as structured value type
  if (p.at('LBrace')) {
    return parseValueType(p, children, typeKeyword, name, eq)
  }

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

// --- type Name = { field: Type, ... } ---

function parseValueType(
  p: ParserContext,
  children: CstChild[],
  typeKeyword: Token,
  name: Token,
  eq: Token,
): ValueTypeDeclNode {
  const lbrace = p.expect('LBrace')
  children.push(lbrace)

  const fields: ValueTypeFieldNode[] = []

  while (!p.at('RBrace') && !p.at('EOF')) {
    if (isDeclStart(p.current())) {
      p.diagnostics.error(p.current().span, DiagnosticCodes.P_UNCLOSED_BRACE, "Unclosed '{'")
      break
    }

    const field = parseValueTypeField(p)
    if (field) {
      fields.push(field)
      children.push(field)
    } else {
      // Recovery: skip one token
      const skipped = p.advance()
      children.push(skipped)
    }
  }

  const rbrace = p.expect('RBrace')
  children.push(rbrace)

  return {
    kind: 'ValueTypeDecl',
    children,
    typeKeyword,
    name,
    eq,
    lbrace,
    fields,
    rbrace,
  }
}

// --- type Name = | tag { fields } | tag { fields } ---

function parseTaggedUnion(
  p: ParserContext,
  children: CstChild[],
  typeKeyword: Token,
  name: Token,
  eq: Token,
): TaggedUnionDeclNode {
  const variants: VariantNode[] = []

  while (p.at('Pipe')) {
    const variantChildren: CstChild[] = []

    const pipe = p.advance() // consume |
    children.push(pipe)
    variantChildren.push(pipe)

    const tag = p.expectIdent()
    children.push(tag)
    variantChildren.push(tag)

    const lbrace = p.expect('LBrace')
    children.push(lbrace)
    variantChildren.push(lbrace)

    const fields: ValueTypeFieldNode[] = []
    while (!p.at('RBrace') && !p.at('EOF')) {
      if (isDeclStart(p.current())) {
        p.diagnostics.error(p.current().span, DiagnosticCodes.P_UNCLOSED_BRACE, "Unclosed '{'")
        break
      }

      const field = parseValueTypeField(p)
      if (field) {
        fields.push(field)
        children.push(field)
        variantChildren.push(field)
      } else {
        const skipped = p.advance()
        children.push(skipped)
        variantChildren.push(skipped)
      }
    }

    const rbrace = p.expect('RBrace')
    children.push(rbrace)
    variantChildren.push(rbrace)

    variants.push({
      kind: 'Variant',
      children: variantChildren,
      pipe,
      tag,
      lbrace,
      fields,
      rbrace,
    })
  }

  return {
    kind: 'TaggedUnionDecl',
    children,
    typeKeyword,
    name,
    eq,
    variants,
  }
}

function parseValueTypeField(p: ParserContext): ValueTypeFieldNode | null {
  if (!p.at('Ident')) return null
  if (p.peek(1).kind !== 'Colon') return null

  const children: CstChild[] = []

  const name = p.advance()
  children.push(name)

  const colon = p.expect('Colon')
  children.push(colon)

  let typeExpr = parseTypeExpr(p)
  children.push(typeExpr)

  // Unwrap NullableType if the type parser consumed `?`
  let nullable: Token | null = null
  if (typeExpr.kind === 'NullableType') {
    const nt = typeExpr as NullableTypeNode
    nullable = nt.question
    typeExpr = nt.inner
  }

  // Optional list suffix: []
  let listSuffix: { lbracket: Token; rbracket: Token } | null = null
  if (!nullable && p.at('LBracket') && p.peek(1).kind === 'RBracket') {
    const lbracket = p.advance()
    const rbracket = p.advance()
    children.push(lbracket)
    children.push(rbracket)
    listSuffix = { lbracket, rbracket }
  }

  let defaultValue: DefaultValueNode | null = null
  if (p.at('Eq')) {
    defaultValue = parseDefaultValue(p)
    children.push(defaultValue)
  }

  // Optional trailing comma
  if (p.at('Comma')) {
    children.push(p.advance())
  }

  return {
    kind: 'ValueTypeField',
    children,
    name,
    colon,
    typeExpr,
    listSuffix,
    nullable,
    defaultValue,
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

// --- data Name = { fields } | data Name = ScalarType ---

function parseDataDecl(p: ParserContext): DataDeclNode {
  const children: CstChild[] = []

  const dataKeyword = p.expectKeyword('data')
  children.push(dataKeyword)

  const name = p.expectIdent()
  children.push(name)

  const eq = p.expect('Eq')
  children.push(eq)

  // Branch: if next token is `{`, parse as structured data type
  if (p.at('LBrace')) {
    const lbrace = p.expect('LBrace')
    children.push(lbrace)

    const fields: ValueTypeFieldNode[] = []
    while (!p.at('RBrace') && !p.at('EOF')) {
      if (isDeclStart(p.current())) {
        p.diagnostics.error(p.current().span, DiagnosticCodes.P_UNCLOSED_BRACE, "Unclosed '{'")
        break
      }
      const field = parseValueTypeField(p)
      if (field) {
        fields.push(field)
        children.push(field)
      } else {
        const skipped = p.advance()
        children.push(skipped)
      }
    }

    const rbrace = p.expect('RBrace')
    children.push(rbrace)

    return {
      kind: 'DataDecl',
      children,
      dataKeyword,
      name,
      eq,
      typeExpr: null,
      lbrace,
      fields,
      rbrace,
    }
  }

  // Scalar alias: data Payload = Bytes
  const typeExpr = parseTypeExpr(p)
  children.push(typeExpr)

  return {
    kind: 'DataDecl',
    children,
    dataKeyword,
    name,
    eq,
    typeExpr,
    lbrace: null,
    fields: [],
    rbrace: null,
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

// { (Attribute | DataDecl | DataRef | Method)* }
function parseBody(p: ParserContext): BodyNode {
  const children: CstChild[] = []

  const lbrace = p.expect('LBrace')
  children.push(lbrace)

  const attributes: AttributeNode[] = []
  const methods: MethodNode[] = []
  const dataDecls: DataDeclNode[] = []
  const dataRefs: DataRefNode[] = []

  while (!p.at('RBrace') && !p.at('EOF')) {
    // If we see a declaration keyword or EOF, the body is probably missing its closing brace.
    if (isDeclStart(p.current())) {
      p.diagnostics.error(p.current().span, DiagnosticCodes.P_UNCLOSED_BRACE, "Unclosed '{'")
      break
    }

    // fn or private fn → method declaration
    if (
      isKeyword(p.current(), 'fn') ||
      (isKeyword(p.current(), 'private') && isKeyword(p.peek(1), 'fn'))
    ) {
      const method = parseMethod(p)
      methods.push(method)
      children.push(method)
      continue
    }

    // data keyword inside body: inline data decl or data ref
    // `data Name = { ... }` or `data Name = Scalar` → inline data declaration
    // `data Name` (no = and no :) → data reference
    // `data: Type` → regular attribute (data is just a field name)
    if (isKeyword(p.current(), 'data') && p.peek(1).kind === 'Ident') {
      if (p.peek(2).kind === 'Eq') {
        const dataDecl = parseDataDecl(p)
        dataDecls.push(dataDecl)
        children.push(dataDecl)
        continue
      } else {
        const dataRef = parseDataRef(p)
        dataRefs.push(dataRef)
        children.push(dataRef)
        continue
      }
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
    dataDecls,
    dataRefs,
    methods,
    rbrace,
  }
}

// data Name (reference to standalone data type, no =)
function parseDataRef(p: ParserContext): DataRefNode {
  const children: CstChild[] = []

  const dataKeyword = p.expectKeyword('data')
  children.push(dataKeyword)

  const name = p.expectIdent()
  children.push(name)

  // Optional trailing comma
  if (p.at('Comma')) {
    children.push(p.advance())
  }

  return {
    kind: 'DataRef',
    children,
    dataKeyword,
    name,
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

// [private] fn name(params): ReturnType { projection }[]?
function parseMethod(p: ParserContext): MethodNode {
  const children: CstChild[] = []

  let privateKeyword: Token | null = null
  if (isKeyword(p.current(), 'private')) {
    privateKeyword = p.advance()
    children.push(privateKeyword)
  }

  const fnKeyword = p.expectKeyword('fn')
  children.push(fnKeyword)

  const name = p.expectIdent()
  children.push(name)

  const lparen = p.expect('LParen')
  children.push(lparen)

  const params: MethodParamNode[] = []

  if (!p.at('RParen') && !p.at('EOF')) {
    const first = parseMethodParam(p)
    params.push(first)
    children.push(first)

    while (p.at('Comma')) {
      const comma = p.advance()
      children.push(comma)
      const param = parseMethodParam(p)
      params.push(param)
      children.push(param)
    }
  }

  const rparen = p.expect('RParen')
  children.push(rparen)

  const colon = p.expect('Colon')
  children.push(colon)

  let returnType = parseTypeExpr(p)
  children.push(returnType)

  // The type parser may have consumed `?` as a NullableType — extract it
  let nullable: Token | null = null
  if (returnType.kind === 'NullableType') {
    const nt = returnType as NullableTypeNode
    nullable = nt.question
    returnType = nt.inner
  }

  // Brace projection: Type { *, field, DataType }
  let projection: ProjectionNode | null = null
  if (!nullable && p.at('LBrace')) {
    projection = parseProjection(p)
    children.push(projection)
  }

  // Optional list suffix: []
  let listSuffix: { lbracket: Token; rbracket: Token } | null = null
  if (!nullable && p.at('LBracket') && p.peek(1).kind === 'RBracket') {
    const lbracket = p.advance()
    const rbracket = p.advance()
    children.push(lbracket)
    children.push(rbracket)
    listSuffix = { lbracket, rbracket }
  }

  return {
    kind: 'Method',
    children,
    privateKeyword,
    fnKeyword,
    name,
    lparen,
    params,
    rparen,
    colon,
    returnType,
    projection,
    listSuffix,
    nullable,
  }
}

// { *, field1, field2, DataType }
function parseProjection(p: ParserContext): ProjectionNode {
  const children: CstChild[] = []

  const lbrace = p.expect('LBrace')
  children.push(lbrace)

  let star: Token | null = null
  const items: Token[] = []

  if (p.at('Star')) {
    star = p.advance()
    children.push(star)
    if (p.at('Comma')) {
      children.push(p.advance())
    }
  }

  while (!p.at('RBrace') && !p.at('EOF')) {
    if (p.at('Ident')) {
      const ident = p.advance()
      items.push(ident)
      children.push(ident)
      if (p.at('Comma')) {
        children.push(p.advance())
      }
    } else {
      break
    }
  }

  const rbrace = p.expect('RBrace')
  children.push(rbrace)

  return {
    kind: 'Projection',
    children,
    lbrace,
    star,
    items,
    rbrace,
  }
}

// name : TypeExpr = default
function parseMethodParam(p: ParserContext): MethodParamNode {
  const children: CstChild[] = []

  const name = p.expectIdent()
  children.push(name)

  const colon = p.expect('Colon')
  children.push(colon)

  const typeExpr = parseTypeExpr(p)
  children.push(typeExpr)

  let defaultValue: DefaultValueNode | null = null
  if (p.at('Eq')) {
    defaultValue = parseDefaultValue(p)
    children.push(defaultValue)
  }

  return {
    kind: 'MethodParam',
    children,
    name,
    colon,
    typeExpr,
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
