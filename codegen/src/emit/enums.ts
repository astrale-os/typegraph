import type { GraphModel } from '../model'

/**
 * Emit `const` tuple + type alias for each enum-like type alias.
 *
 * ```ts
 * export const PlanValues = ['free', 'pro', 'enterprise'] as const
 * export type Plan = (typeof PlanValues)[number]
 * ```
 */
export function emitEnums(model: GraphModel): string {
  const lines: string[] = []

  for (const [, alias] of model.aliases) {
    if (!alias.isEnum || !alias.enumValues) continue

    const valuesName = `${alias.name}Values`
    const values = alias.enumValues.map((v) => `'${v}'`).join(', ')

    lines.push(`export const ${valuesName} = [${values}] as const`)
    lines.push(`export type ${alias.name} = (typeof ${valuesName})[number]`)
    lines.push('')
  }

  return lines.join('\n')
}
