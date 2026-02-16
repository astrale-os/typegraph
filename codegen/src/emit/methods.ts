import type { GraphModel, MethodDef } from '../model'
import { resolveMethodReturnTypeRef, resolveMethodParamTypeRef } from './interfaces'
import { pascalCase } from './utils'

/**
 * Emit method-related types:
 *  1. *Methods interfaces (one per type with methods)
 *  2. Enriched node types (*Node) and SchemaNodeTypeMap
 *
 * Runs after interfaces, before validators.
 */
export function emitMethods(model: GraphModel): string {
  const nodesWithMethods = [...model.nodeDefs.values()].filter((n) => n.allMethods.length > 0)
  const edgesWithMethods = [...model.edgeDefs.values()].filter((e) => e.allMethods.length > 0)
  const concreteNodes = [...model.nodeDefs.values()].filter((n) => !n.abstract && !n.origin)

  const hasAnyMethods = nodesWithMethods.length > 0 || edgesWithMethods.length > 0
  if (!hasAnyMethods && concreteNodes.length === 0) return ''

  const lines: string[] = []

  // ── Method Interfaces ──────────────────────────────────────
  if (hasAnyMethods) {
    for (const node of nodesWithMethods) {
      lines.push(emitMethodInterface(model, node.name, node.ownMethods))
    }
    for (const edge of edgesWithMethods) {
      lines.push(emitMethodInterface(model, pascalCase(edge.name), edge.ownMethods))
    }
  }

  // ── Enriched Node Types + SchemaNodeTypeMap ────────────────
  if (concreteNodes.length > 0) {
    lines.push(emitEnrichedTypes(model))
  }

  return lines.join('\n')
}

// ─── Method Interface ────────────────────────────────────────

function emitMethodInterface(model: GraphModel, typeName: string, methods: MethodDef[]): string {
  if (methods.length === 0) return ''
  const lines: string[] = []
  lines.push(`export interface ${typeName}Methods {`)
  for (const m of methods) {
    const returnTs = formatReturnType(model, m)
    const paramStr = formatMethodParams(model, m)
    lines.push(`  ${m.name}${paramStr}: ${returnTs}`)
  }
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

function formatReturnType(model: GraphModel, m: MethodDef): string {
  let ts = resolveMethodReturnTypeRef(model, m.return_type)
  if (m.return_nullable) ts = `${ts} | null`
  return `${ts} | Promise<${ts}>`
}

function formatMethodParams(model: GraphModel, m: MethodDef): string {
  if (m.params.length === 0) return '()'

  const allHaveDefaults = m.params.every((p) => p.default !== null)

  const fields = m.params.map((p) => {
    const ts = resolveMethodParamTypeRef(model, p.type)
    const opt = p.default !== null ? '?' : ''
    return `${p.name}${opt}: ${ts}`
  })

  const argsOptional = allHaveDefaults ? '?' : ''
  return `(args${argsOptional}: { ${fields.join('; ')} })`
}

// ─── Enriched Node Types ─────────────────────────────────────

function emitEnrichedTypes(model: GraphModel): string {
  const lines: string[] = []
  const concretes = [...model.nodeDefs.values()].filter((n) => !n.abstract && !n.origin)

  for (const node of concretes) {
    const methodIntersections = collectMethodInterfaces(model, node.name)
    const methodPart = methodIntersections.length > 0 ? ' & ' + methodIntersections.join(' & ') : ''

    lines.push(`export type ${node.name}Node = ${node.name} & {`)
    lines.push(`  readonly id: ${node.name}Id`)
    lines.push(`  readonly __type: '${node.name}'`)
    lines.push(`}${methodPart}`)
    lines.push('')
  }

  // SchemaNodeTypeMap
  lines.push('export interface SchemaNodeTypeMap {')
  for (const node of concretes) {
    lines.push(`  ${node.name}: ${node.name}Node`)
  }
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Collect all *Methods interface names that should be intersected
 * onto an enriched node type: own methods + each interface's methods.
 */
function collectMethodInterfaces(model: GraphModel, typeName: string): string[] {
  const result: string[] = []
  const node = model.nodeDefs.get(typeName)
  if (!node) return result

  // Own methods interface
  if (node.ownMethods.length > 0) {
    result.push(`${typeName}Methods`)
  }

  // Inherited method interfaces (walk implements chain)
  for (const parentName of node.implements) {
    const parent = model.nodeDefs.get(parentName)
    if (parent && parent.ownMethods.length > 0) {
      result.push(`${parentName}Methods`)
    }
    // Recurse for grandparent interfaces
    const grandparent = collectMethodInterfaces(model, parentName)
    for (const gp of grandparent) {
      if (!result.includes(gp)) result.push(gp)
    }
  }

  return result
}
