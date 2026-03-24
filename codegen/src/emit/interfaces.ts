import type {
  GraphModel,
  ResolvedNode,
  ResolvedEdge,
  ResolvedValueType,
  ResolvedTaggedUnion,
  ResolvedDataType,
  IRAttribute,
  TypeRef,
} from '../model'

import { scalarToTs } from './scalars'
import { pascalCase, section } from './utils'

export function emitInterfaces(model: GraphModel): string {
  const parts: string[] = []

  // Non-enum type aliases (e.g. Email = string, Slug = string)
  const nonEnumAliases = [...model.aliases.values()].filter((a) => !a.isEnum)
  if (nonEnumAliases.length > 0) {
    parts.push(section('Type Aliases'))
    for (const alias of nonEnumAliases) {
      const tsType = scalarToTs(alias.underlyingType)
      if (alias.constraints?.format) {
        parts.push(`/** ${alias.underlyingType} with format: ${alias.constraints.format} */`)
      }
      parts.push(`export type ${alias.name} = ${tsType}`)
    }
    parts.push('')
  }

  // Value types → interfaces
  const valueTypes = [...model.valueTypes.values()]
  if (valueTypes.length > 0) {
    parts.push(section('Value Types'))
    parts.push('')
    for (const vt of valueTypes) {
      parts.push(emitValueTypeInterface(model, vt))
    }
  }

  // Tagged unions → discriminated union types
  const taggedUnions = [...model.taggedUnions.values()]
  if (taggedUnions.length > 0) {
    parts.push(section('Tagged Unions'))
    parts.push('')
    for (const tu of taggedUnions) {
      parts.push(emitTaggedUnionType(model, tu))
    }
  }

  // Data types → interfaces (for structured) or type aliases (for scalar)
  const dataTypes = [...model.dataTypes.values()]
  if (dataTypes.length > 0) {
    parts.push(section('Data Types'))
    parts.push('')
    for (const dt of dataTypes) {
      parts.push(emitDataTypeInterface(model, dt))
    }
    parts.push('export type WithData<T, D> = T & { data(): Promise<D> }')
    parts.push('')
  }

  // Abstract nodes → interfaces
  const abstracts = [...model.nodeDefs.values()].filter((n) => n.abstract)
  if (abstracts.length > 0) {
    parts.push(section('Node Interfaces'))
    parts.push('')
    for (const node of abstracts) {
      parts.push(emitNodeInterface(model, node))
    }
  }

  // Concrete nodes → interfaces
  const concretes = [...model.nodeDefs.values()].filter((n) => !n.abstract)
  if (concretes.length > 0) {
    parts.push(section('Node Types'))
    parts.push('')
    for (const node of concretes) {
      parts.push(emitNodeInterface(model, node))
    }
  }

  // Edge payloads (only edges with attributes)
  const edgesWithPayload = [...model.edgeDefs.values()].filter((e) => e.ownAttributes.length > 0)
  if (edgesWithPayload.length > 0) {
    parts.push(section('Edge Payloads'))
    parts.push('')
    for (const edge of edgesWithPayload) {
      parts.push(emitEdgePayload(model, edge))
    }
  }

  return parts.join('\n')
}

// ─── Helpers ────────────────────────────────────────────────

function emitDataTypeInterface(model: GraphModel, dt: ResolvedDataType): string {
  if (dt.scalarType) {
    const tsType = scalarToTs(dt.scalarType)
    return `export type ${dt.name} = ${tsType}\n`
  }
  if (!dt.fields || dt.fields.length === 0) {
    return `export interface ${dt.name} {}\n`
  }
  const fields = dt.fields.map((f) => {
    const tsType = resolveTypeRef(model, f.type)
    const optional = f.nullable ? '?' : ''
    const nullUnion = f.nullable ? ' | null' : ''
    return `  ${f.name}${optional}: ${tsType}${nullUnion}`
  })
  return `export interface ${dt.name} {\n${fields.join('\n')}\n}\n`
}

function emitTaggedUnionType(model: GraphModel, tu: ResolvedTaggedUnion): string {
  const variantTypes = tu.variants.map((v) => {
    const fields = v.fields.map((f) => {
      const tsType = resolveTypeRef(model, f.type)
      const optional = f.nullable ? '?' : ''
      const nullUnion = f.nullable ? ' | null' : ''
      return `    ${f.name}${optional}: ${tsType}${nullUnion}`
    })
    const kindField = `    kind: '${v.tag}'`
    return `  | {\n${kindField}\n${fields.join('\n')}\n  }`
  })
  return `export type ${tu.name} =\n${variantTypes.join('\n')}\n`
}

function emitValueTypeInterface(model: GraphModel, vt: ResolvedValueType): string {
  if (vt.fields.length === 0) {
    return `export interface ${vt.name} {}\n`
  }

  const fields = vt.fields.map((f) => {
    const tsType = resolveTypeRef(model, f.type)
    const optional = f.nullable ? '?' : ''
    const nullUnion = f.nullable ? ' | null' : ''
    return `  ${f.name}${optional}: ${tsType}${nullUnion}`
  })
  return `export interface ${vt.name} {\n${fields.join('\n')}\n}\n`
}

function emitNodeInterface(model: GraphModel, node: ResolvedNode): string {
  const extendsClause = node.implements.length > 0 ? ` extends ${node.implements.join(', ')}` : ''

  if (node.ownAttributes.length === 0) {
    return `export interface ${node.name}${extendsClause} {}\n`
  }

  const fields = node.ownAttributes.map((a) => formatField(model, a))
  return `export interface ${node.name}${extendsClause} {\n${fields.join('\n')}\n}\n`
}

function emitEdgePayload(_model: GraphModel, edge: ResolvedEdge): string {
  const name = `${pascalCase(edge.name)}Payload`
  const fields = edge.ownAttributes.map((a) => formatField(_model, a))
  return `export interface ${name} {\n${fields.join('\n')}\n}\n`
}

function formatField(model: GraphModel, attr: IRAttribute): string {
  const tsType = resolveTypeRef(model, attr.type)
  const optional = attr.nullable ? '?' : ''
  const nullUnion = attr.nullable ? ' | null' : ''
  return `  ${attr.name}${optional}: ${tsType}${nullUnion}`
}

// oxlint-disable-next-line only-used-in-recursion
export function resolveTypeRef(model: GraphModel, ref: TypeRef): string {
  switch (ref.kind) {
    case 'Scalar':
      return scalarToTs(ref.name)
    case 'Alias':
      return ref.name
    case 'Node':
      return 'string' // node reference = ID
    case 'Edge':
      return 'string'
    case 'ValueType':
      return ref.name
    case 'TaggedUnion':
      return ref.name
    case 'AnyEdge':
      return 'string'
    case 'List':
      return `${resolveTypeRef(model, ref.element)}[]`
    case 'Union':
      return ref.types.map((t) => resolveTypeRef(model, t)).join(' | ')
    default:
      return 'unknown'
  }
}

/**
 * Resolve a TypeRef for method return types.
 * Node refs resolve to the interface name (e.g. `Order`),
 * since method returns deal with actual objects.
 */
// oxlint-disable-next-line only-used-in-recursion
export function resolveMethodReturnTypeRef(model: GraphModel, ref: TypeRef): string {
  switch (ref.kind) {
    case 'Scalar':
      return scalarToTs(ref.name)
    case 'Alias':
      return ref.name
    case 'Node':
      return ref.name
    case 'Edge':
      return pascalCase(ref.name) + 'Payload'
    case 'ValueType':
      return ref.name
    case 'TaggedUnion':
      return ref.name
    case 'AnyEdge':
      return 'unknown'
    case 'List':
      return `${resolveMethodReturnTypeRef(model, ref.element)}[]`
    case 'Union':
      return ref.types.map((t) => resolveMethodReturnTypeRef(model, t)).join(' | ')
    default:
      return 'unknown'
  }
}

/**
 * Resolve a TypeRef for method parameters.
 * Node refs resolve to branded IDs (e.g. `UserId`),
 * since callers pass node references by ID.
 */
// oxlint-disable-next-line only-used-in-recursion
export function resolveMethodParamTypeRef(model: GraphModel, ref: TypeRef): string {
  switch (ref.kind) {
    case 'Scalar':
      return scalarToTs(ref.name)
    case 'Alias':
      return ref.name
    case 'Node':
      return `${ref.name}Id`
    case 'Edge':
      return pascalCase(ref.name) + 'Payload'
    case 'ValueType':
      return ref.name
    case 'TaggedUnion':
      return ref.name
    case 'AnyEdge':
      return 'unknown'
    case 'List':
      return `${resolveMethodParamTypeRef(model, ref.element)}[]`
    case 'Union':
      return ref.types.map((t) => resolveMethodParamTypeRef(model, t)).join(' | ')
    default:
      return 'unknown'
  }
}
