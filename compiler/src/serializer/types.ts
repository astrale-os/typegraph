// serializer/types.ts
// ============================================================
// TypeRef Serialization
//
// Converts AST type expressions into IR TypeRef discriminated unions.
// ============================================================

import {
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type EdgeRefType,
} from '../ast/index.js'
import { type TypeRef } from '../ir/index.js'
import { type Symbol } from '../resolver/index.js'
import { type SerializerContext } from './index.js'

export function serializeTypeRef(ctx: SerializerContext, expr: TypeExpr): TypeRef {
  switch (expr.kind) {
    case 'NamedType': {
      const name = (expr as NamedType).name.value
      const sym = ctx.schema.symbols.get(name)
      if (!sym) return { kind: 'Scalar', name }
      return symbolToTypeRef(sym, name)
    }
    case 'NullableType':
      return serializeTypeRef(ctx, (expr as NullableType).inner)
    case 'UnionType':
      return {
        kind: 'Union',
        types: (expr as UnionType).types.map((t) => serializeTypeRef(ctx, t)),
      }
    case 'EdgeRefType': {
      const target = (expr as EdgeRefType).target
      if (!target) return { kind: 'AnyEdge' }
      return { kind: 'Edge', name: target.value }
    }
    default:
      return { kind: 'Scalar', name: 'String' }
  }
}

function symbolToTypeRef(sym: Symbol, name: string): TypeRef {
  switch (sym.symbolKind) {
    case 'Scalar':
      return { kind: 'Scalar', name }
    case 'TypeAlias':
      return { kind: 'Alias', name }
    case 'Interface':
    case 'Class':
      return { kind: 'Node', name }
    case 'Edge':
      return { kind: 'Edge', name }
    default:
      return { kind: 'Scalar', name }
  }
}
