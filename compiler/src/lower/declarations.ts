// lower/declarations.ts
// ============================================================
// Declaration Lowering — CST → AST
//
// Handles type aliases, interfaces, classes (nodes + edges),
// extend declarations, and shared components (params, attrs).
// ============================================================

import {
  type DeclarationNode,
  type ClassDeclNode,
  type InterfaceDeclNode,
  type TypeAliasDeclNode,
  type ValueTypeDeclNode,
  type ValueTypeFieldNode,
  type NullableTypeNode,
  type ExtendDeclNode,
  type AttributeNode,
  type ParamNode,
  type MethodNode,
  type MethodParamNode,
  spanOf,
} from '../cst/index'
import {
  type Declaration,
  type TypeAliasDecl,
  type ValueTypeDecl,
  type ValueTypeField,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type ExtendDecl,
  type Attribute,
  type Param,
  type Method,
  type MethodParam,
  type Name,
} from '../ast/index'
import { type Token } from '../tokens'
import { type LoweringContext } from './index'
import { lowerTypeExpr } from './types'
import { lowerModifiers } from './modifiers'
import { lowerExpression } from './expressions'

// --- Declaration dispatch ---

export function lowerDeclaration(ctx: LoweringContext, node: DeclarationNode): Declaration | null {
  switch (node.kind) {
    case 'TypeAliasDecl':
      return lowerTypeAlias(ctx, node)
    case 'ValueTypeDecl':
      return lowerValueType(ctx, node)
    case 'InterfaceDecl':
      return lowerInterface(ctx, node)
    case 'ClassDecl':
      return lowerClass(ctx, node)
    case 'ExtendDecl':
      return lowerExtend(node)
    default:
      return null
  }
}

function lowerTypeAlias(ctx: LoweringContext, node: TypeAliasDeclNode): TypeAliasDecl {
  return {
    kind: 'TypeAliasDecl',
    name: lowerName(node.name),
    type: lowerTypeExpr(node.typeExpr),
    modifiers: lowerModifiers(ctx, node.modifiers),
    span: spanOf(node),
  }
}

function lowerValueType(ctx: LoweringContext, node: ValueTypeDeclNode): ValueTypeDecl {
  return {
    kind: 'ValueTypeDecl',
    name: lowerName(node.name),
    fields: node.fields.map((f) => lowerValueTypeField(ctx, f)),
    span: spanOf(node),
  }
}

function lowerValueTypeField(ctx: LoweringContext, node: ValueTypeFieldNode): ValueTypeField {
  // The parser already unwraps NullableType and extracts listSuffix,
  // but handle the case where typeExpr might still be nullable (shouldn't happen, but be safe)
  let typeExpr = node.typeExpr
  let nullable = node.nullable !== null
  if (typeExpr.kind === 'NullableType') {
    const nt = typeExpr as NullableTypeNode
    typeExpr = nt.inner
    nullable = true
  }

  return {
    name: lowerName(node.name),
    type: lowerTypeExpr(typeExpr),
    nullable,
    list: node.listSuffix !== null,
    defaultValue: node.defaultValue ? lowerExpression(ctx, node.defaultValue.expression) : null,
    span: spanOf(node),
  }
}

function lowerInterface(ctx: LoweringContext, node: InterfaceDeclNode): InterfaceDecl {
  return {
    kind: 'InterfaceDecl',
    name: lowerName(node.name),
    extends: node.extendsClause ? node.extendsClause.names.items.map((t) => lowerName(t)) : [],
    attributes: node.body ? node.body.attributes.map((a) => lowerAttribute(ctx, a)) : [],
    methods: node.body ? node.body.methods.map((m) => lowerMethod(ctx, m)) : [],
    span: spanOf(node),
  }
}

function lowerClass(ctx: LoweringContext, node: ClassDeclNode): NodeDecl | EdgeDecl {
  // Split: if signature is present → EdgeDecl, otherwise NodeDecl
  if (node.signature) {
    return lowerEdge(ctx, node)
  }
  return lowerNodeClass(ctx, node)
}

function lowerNodeClass(ctx: LoweringContext, node: ClassDeclNode): NodeDecl {
  return {
    kind: 'NodeDecl',
    name: lowerName(node.name),
    implements: node.extendsClause ? node.extendsClause.names.items.map((t) => lowerName(t)) : [],
    modifiers: lowerModifiers(ctx, node.modifiers),
    attributes: node.body ? node.body.attributes.map((a) => lowerAttribute(ctx, a)) : [],
    methods: node.body ? node.body.methods.map((m) => lowerMethod(ctx, m)) : [],
    span: spanOf(node),
  }
}

function lowerEdge(ctx: LoweringContext, node: ClassDeclNode): EdgeDecl {
  return {
    kind: 'EdgeDecl',
    name: lowerName(node.name),
    params: node.signature!.params.map((p) => lowerParam(p)),
    implements: node.extendsClause ? node.extendsClause.names.items.map((t) => lowerName(t)) : [],
    modifiers: lowerModifiers(ctx, node.modifiers),
    attributes: node.body ? node.body.attributes.map((a) => lowerAttribute(ctx, a)) : [],
    methods: node.body ? node.body.methods.map((m) => lowerMethod(ctx, m)) : [],
    span: spanOf(node),
  }
}

function lowerExtend(node: ExtendDeclNode): ExtendDecl {
  return {
    kind: 'ExtendDecl',
    uri: unquote(node.uri.text),
    imports: node.imports.items.map((t) => lowerName(t)),
    span: spanOf(node),
  }
}

// --- Components ---

function lowerParam(node: ParamNode): Param {
  return {
    name: lowerName(node.name),
    type: lowerTypeExpr(node.typeExpr),
    span: spanOf(node),
  }
}

function lowerMethod(ctx: LoweringContext, node: MethodNode): Method {
  return {
    kind: 'Method',
    name: lowerName(node.name),
    params: node.params.map((p) => lowerMethodParam(ctx, p)),
    returnType: lowerTypeExpr(node.returnType),
    returnList: node.listSuffix !== null,
    returnNullable: node.nullable !== null,
    span: spanOf(node),
  }
}

function lowerMethodParam(ctx: LoweringContext, node: MethodParamNode): MethodParam {
  return {
    name: lowerName(node.name),
    type: lowerTypeExpr(node.typeExpr),
    defaultValue: node.defaultValue ? lowerExpression(ctx, node.defaultValue.expression) : null,
    span: spanOf(node),
  }
}

function lowerAttribute(ctx: LoweringContext, node: AttributeNode): Attribute {
  return {
    name: lowerName(node.name),
    type: lowerTypeExpr(node.typeExpr),
    modifiers: lowerModifiers(ctx, node.modifiers),
    defaultValue: node.defaultValue ? lowerExpression(ctx, node.defaultValue.expression) : null,
    span: spanOf(node),
  }
}

export function lowerName(token: Token): Name {
  return {
    value: token.text,
    span: token.span,
  }
}

// --- Utilities ---

/** Remove surrounding quotes and unescape. */
export function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\(.)/g, '$1')
  }
  return s
}
