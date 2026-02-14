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
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type NamedType,
  type TypeExpr,
  type NullableType,
  type UnionType,
  type EdgeRefType,
  type CardinalityModifier,
} from '../ast/index.js'
import {
  type Extension,
  type TypeAlias,
  type NodeDef,
  type EdgeDef,
  type Endpoint,
  type Cardinality,
  type TypeRef,
} from '../ir/index.js'
import { type SerializerContext } from './index.js'
import { serializeTypeRef } from './types.js'
import { serializeAttribute } from './attributes.js'
import { extractEdgeConstraints, extractValueConstraints } from './modifiers.js'

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

export function serializeInterface(ctx: SerializerContext, decl: InterfaceDecl): NodeDef {
  return {
    type: 'node',
    name: decl.name.value,
    abstract: true,
    implements: decl.extends.map((e) => e.value),
    attributes: decl.attributes.map((a) => serializeAttribute(ctx, a)),
  }
}

export function serializeClass(ctx: SerializerContext, decl: NodeDecl): NodeDef {
  return {
    type: 'node',
    name: decl.name.value,
    abstract: false,
    implements: decl.implements.map((i) => i.value),
    attributes: decl.attributes.map((a) => serializeAttribute(ctx, a)),
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
    constraints: extractEdgeConstraints(decl.modifiers),
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
