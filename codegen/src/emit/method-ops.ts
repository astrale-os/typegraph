import type { GraphModel, MethodDef, MethodParam } from '../model'
import { resolveZodTypeRef, renderDefault } from './zod-utils'
import { pascalCase } from './utils'

/**
 * Emit `*Ops` constants — typed `op(...)` calls for every type with methods.
 *
 * Generated output:
 * ```
 * export const CustomerOps = {
 *   displayName: op('Customer.displayName', 'public', z.object({}), z.string()),
 *   recentOrders: op('Customer.recentOrders', 'private', z.object({ limit: z.number().int().default(10) }), z.array(validators.Order)),
 * } as const
 * ```
 */
export function emitMethodOps(model: GraphModel): string {
  const lines: string[] = []

  // Nodes with methods
  for (const [, node] of model.nodeDefs) {
    if (node.allMethods.length === 0) continue
    lines.push(emitOpsConst(model, node.name, node.name, node.allMethods))
    lines.push('')
  }

  // Edges with methods (const is PascalCase, op name uses raw edge name)
  for (const [, edge] of model.edgeDefs) {
    if (edge.allMethods.length === 0) continue
    lines.push(emitOpsConst(model, pascalCase(edge.name), edge.name, edge.allMethods))
    lines.push('')
  }

  return lines.join('\n')
}

function emitOpsConst(
  model: GraphModel,
  constName: string,
  opPrefix: string,
  methods: MethodDef[],
): string {
  const lines: string[] = []
  lines.push(`export const ${constName}Ops = {`)

  for (const m of methods) {
    const params = buildParamsSchema(model, m.params)
    const result = buildResultSchema(model, m)
    lines.push(`  ${m.name}: op('${opPrefix}.${m.name}', '${m.access}', ${params}, ${result}),`)
  }

  lines.push('} as const')
  return lines.join('\n')
}

function buildParamsSchema(model: GraphModel, params: MethodParam[]): string {
  if (params.length === 0) return 'z.object({})'

  const fields = params.map((p) => {
    let chain = resolveZodTypeRef(model, p.type)
    if (p.default !== null) {
      const val = renderDefault(p.default)
      if (val !== null) chain = `${chain}.default(${val})`
    }
    return `${p.name}: ${chain}`
  })

  return `z.object({ ${fields.join(', ')} })`
}

function buildResultSchema(model: GraphModel, m: MethodDef): string {
  let result = resolveZodTypeRef(model, m.return_type, 'result')
  if (m.return_nullable) result = `${result}.nullable()`
  return result
}
