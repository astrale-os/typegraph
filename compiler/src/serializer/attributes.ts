// serializer/attributes.ts
// ============================================================
// Attribute & Value Serialization
//
// Converts AST attributes and expressions into IR format.
// ============================================================

import { type Attribute, type Expression } from '../ast/index'
import { type IRAttribute, type ValueNode } from '../ir/index'
import { type SerializerContext } from './index'
import { serializeTypeRef } from './types'
import { extractAttributeModifiers } from './modifiers'

export function serializeAttribute(ctx: SerializerContext, attr: Attribute): IRAttribute {
  return {
    name: attr.name.value,
    type: serializeTypeRef(ctx, attr.type),
    nullable: attr.type.kind === 'NullableType',
    default: attr.defaultValue ? serializeValueNode(attr.defaultValue) : null,
    modifiers: extractAttributeModifiers(attr.modifiers),
  }
}

export function serializeValueNode(expr: Expression): ValueNode {
  switch (expr.kind) {
    case 'StringLiteral':
      return { kind: 'StringLiteral', value: expr.value }
    case 'NumberLiteral':
      return { kind: 'NumberLiteral', value: expr.value }
    case 'BooleanLiteral':
      return { kind: 'BooleanLiteral', value: expr.value }
    case 'NullLiteral':
      return { kind: 'Null' }
    case 'CallExpression':
      return { kind: 'Call', fn: expr.fn.value, args: [] }
    default:
      return { kind: 'Null' }
  }
}
