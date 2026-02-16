import type { ValidatorMap } from './types'
import { ValidationError } from './errors'

/**
 * Validate input for node creation using the Zod validator.
 */
export function validateCreateInput(
  type: string,
  input: unknown,
  validators: ValidatorMap | undefined,
): Record<string, unknown> {
  if (!validators?.[type]) return input as Record<string, unknown>
  const result = validators[type].safeParse(input)
  if (!result.success) {
    throw new ValidationError(
      `Validation failed for ${type}: ${(result as any).error?.message ?? 'invalid input'}`,
      (result as any).error?.issues ?? [],
    )
  }
  return result.data as Record<string, unknown>
}

/**
 * Validate partial input for node updates.
 */
export function validateUpdateInput(
  type: string,
  input: unknown,
  validators: ValidatorMap | undefined,
): Record<string, unknown> {
  if (!validators?.[type]) return input as Record<string, unknown>
  // Use .partial() for update validation — all fields become optional
  const partial = (validators[type] as any).partial?.() ?? validators[type]
  const result = partial.safeParse(input)
  if (!result.success) {
    throw new ValidationError(
      `Validation failed for ${type} update: ${(result as any).error?.message ?? 'invalid input'}`,
      (result as any).error?.issues ?? [],
    )
  }
  return result.data as Record<string, unknown>
}

/**
 * Validate edge payload.
 */
export function validateEdgePayload(
  edgeType: string,
  payload: unknown,
  validators: ValidatorMap | undefined,
): Record<string, unknown> | undefined {
  if (payload === undefined || payload === null) return undefined
  const name = pascalCase(edgeType)
  if (!validators?.[name]) return payload as Record<string, unknown>
  const result = validators[name].safeParse(payload)
  if (!result.success) {
    throw new ValidationError(
      `Validation failed for ${edgeType} payload: ${(result as any).error?.message ?? 'invalid input'}`,
      (result as any).error?.issues ?? [],
    )
  }
  return result.data as Record<string, unknown>
}

function pascalCase(s: string): string {
  return s
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}
