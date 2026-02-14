// serializer/declarations.ts
// ============================================================
// Declaration Serialization
//
// Converts AST declarations into IR definitions: Extensions,
// TypeAliases, NodeDefs, and EdgeDefs.
// ============================================================

import {
  type ExtendDecl,
  type TypeAliasDecl,
  type ValueTypeDecl,
  type ValueTypeField as AstValueTypeField,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type Method,
  type MethodParam as AstMethodParam,
  type NamedType,
  type TypeExpr,
  type NullableType,
  type UnionType,
  type EdgeRefType,
  type CardinalityModifier,
} from '../ast/index'
import {
  type Extension,
  type TypeAlias,
  type ValueTypeDef,
  type ValueTypeField,
  type NodeDef,
  type EdgeDef,
  type MethodDef,
  type MethodParam,
  type Endpoint,
  type Cardinality,
  type TypeRef,
} from '../ir/index'
import { type SerializerContext } from './index'
import { serializeTypeRef } from './types'
import { serializeAttribute, serializeValueNode } from './attributes'
import { extractEdgeConstraints, extractValueConstraints } from './modifiers'

export function serializeExtend(decl: ExtendDecl): Extension {
  return {
    uri: decl.uri,
    imported_types: decl.imports.map((i) => i.value),
  }
}

export function serializeTypeAlias(ctx: SerializerContext, decl: TypeAliasDecl): TypeAlias {
  let underlyingType = ''
  if (decl.type.kind === 'NamedType') {
    underlyingType = (decl.type as NamedType).name.value
  }

  return {
    name: decl.name.value,
    underlying_type: underlyingType,
    constraints: extractValueConstraints(decl.modifiers),
  }
}

export function serializeValueType(ctx: SerializerContext, decl: ValueTypeDecl): ValueTypeDef {
  return {
    name: decl.name.value,
    fields: decl.fields.map((f) => serializeValueTypeField(ctx, f)),
  }
}

function serializeValueTypeField(ctx: SerializerContext, field: AstValueTypeField): ValueTypeField {
  let typeRef = serializeTypeRef(ctx, field.type)
  if (field.list) {
    typeRef = { kind: 'List', element: typeRef }
  }

  return {
    name: field.name.value,
    type: typeRef,
    nullable: field.nullable,
    default: field.defaultValue ? serializeValueNode(field.defaultValue) : null,
  }
}

export function serializeInterface(ctx: SerializerContext, decl: InterfaceDecl): NodeDef {
  return {
    type: 'node',
    name: decl.name.value,
    abstract: true,
    implements: decl.extends.map((e) => e.value),
    attributes: decl.attributes.map((a) => serializeAttribute(ctx, a)),
    methods: decl.methods.map((m) => serializeMethod(ctx, m)),
  }
}

export function serializeNode(ctx: SerializerContext, decl: NodeDecl): NodeDef {
  return {
    type: 'node',
    name: decl.name.value,
    abstract: false,
    implements: decl.implements.map((i) => i.value),
    attributes: decl.attributes.map((a) => serializeAttribute(ctx, a)),
    methods: decl.methods.map((m) => serializeMethod(ctx, m)),
  }
}

export function serializeEdge(ctx: SerializerContext, decl: EdgeDecl): EdgeDef {
  // Build cardinality map from modifiers
  const cardinalityMap = new Map<string, Cardinality>()
  for (const mod of decl.modifiers) {
    if (mod.kind === 'CardinalityModifier') {
      const cm = mod as CardinalityModifier
      cardinalityMap.set(cm.param.value, { min: cm.min, max: cm.max })
    }
  }

  return {
    type: 'edge',
    name: decl.name.value,
    endpoints: decl.params.map((p) => serializeEndpoint(ctx, p, cardinalityMap)),
    attributes: decl.attributes.map((a) => serializeAttribute(ctx, a)),
    methods: decl.methods.map((m) => serializeMethod(ctx, m)),
    constraints: extractEdgeConstraints(decl.modifiers),
  }
}

function serializeMethod(ctx: SerializerContext, method: Method): MethodDef {
  let returnType = serializeTypeRef(ctx, method.returnType)
  if (method.returnList) {
    returnType = { kind: 'List', element: returnType }
  }

  return {
    name: method.name.value,
    params: method.params.map((p) => serializeMethodParam(ctx, p)),
    return_type: returnType,
    return_nullable: method.returnNullable,
  }
}

function serializeMethodParam(ctx: SerializerContext, param: AstMethodParam): MethodParam {
  return {
    name: param.name.value,
    type: serializeTypeRef(ctx, param.type),
    default: param.defaultValue ? serializeValueNode(param.defaultValue) : null,
  }
}

function serializeEndpoint(
  ctx: SerializerContext,
  param: { name: { value: string }; type: TypeExpr },
  cardinalityMap: Map<string, Cardinality>,
): Endpoint {
  return {
    param_name: param.name.value,
    allowed_types: extractEndpointTypes(ctx, param.type),
    cardinality: cardinalityMap.get(param.name.value) ?? null,
  }
}

function extractEndpointTypes(ctx: SerializerContext, expr: TypeExpr): TypeRef[] {
  switch (expr.kind) {
    case 'NamedType':
      return [serializeTypeRef(ctx, expr)]
    case 'UnionType':
      return (expr as UnionType).types.flatMap((t) => extractEndpointTypes(ctx, t))
    case 'NullableType':
      return extractEndpointTypes(ctx, (expr as NullableType).inner)
    case 'EdgeRefType': {
      const target = (expr as EdgeRefType).target
      if (!target) return [{ kind: 'AnyEdge' }]
      return [{ kind: 'Edge', name: target.value }]
    }
    default:
      return []
  }
}
