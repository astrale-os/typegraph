import type { Def } from '../defs/definition.js'
import type { FnDef, MethodInheritance } from '../defs/function.js'

import { getDefName } from '../registry.js'
import { SchemaValidationError } from '../schema/schema.js'

/** Resolved method with origin tracking for inheritance-aware validation. */
export interface ResolvedMethod {
  /** The FnDef for this method. */
  fnDef: FnDef
  /** Effective inheritance: 'sealed' | 'abstract' | 'default'. */
  inheritance: MethodInheritance
  /** Name of the def that owns this method (interface or class). */
  origin: string
  /** Whether this method overrides a parent's default implementation (auto-deduced). */
  isOverride: boolean
}

/** Collect all method FnDef objects (own + inherited) from a def. */
export function collectAllMethodDefs(def: Def): Record<string, FnDef> {
  const out: Record<string, FnDef> = {}

  if (def.config.inherits) {
    for (const parent of def.config.inherits) {
      Object.assign(out, collectAllMethodDefs(parent))
    }
  }

  if (def.config.methods) Object.assign(out, def.config.methods)
  return out
}

/** Collect all method names (own + inherited). */
export function collectAllMethodNames(def: Def): Set<string> {
  return new Set(Object.keys(collectAllMethodDefs(def)))
}

// ── Inheritance-aware resolution ──────────────────────────────────────────

function getParamKeys(fnDef: FnDef): string[] {
  const raw = fnDef.config.params
  const params = typeof raw === 'function' ? raw() : raw
  return params ? Object.keys(params) : []
}

function getInheritance(fnDef: FnDef): MethodInheritance {
  const m = (fnDef.config as { inheritance?: MethodInheritance }).inheritance
  if (m === 'sealed') return 'sealed'
  if (m === 'abstract') return 'abstract'
  return 'default'
}

interface InheritedAccum {
  methods: Record<string, ResolvedMethod>
  /** Track all origins per method name for diamond detection. */
  originsByMethod: Record<string, string[]>
}

function collectInherited(
  // oxlint-disable-next-line no-explicit-any
  inherits: readonly Def<any>[] | undefined,
): InheritedAccum {
  const acc: InheritedAccum = { methods: {}, originsByMethod: {} }
  if (!inherits) return acc

  for (const parent of inherits) {
    const parentResolved = resolveAllMethods(parent)
    for (const [name, rm] of Object.entries(parentResolved)) {
      const existing = acc.methods[name]
      if (existing) {
        // Track multiple origins for diamond detection
        if (existing.origin !== rm.origin) {
          if (!acc.originsByMethod[name]) acc.originsByMethod[name] = [existing.origin]
          if (!acc.originsByMethod[name].includes(rm.origin)) {
            acc.originsByMethod[name].push(rm.origin)
          }
        }
        // Sealed wins over everything (it's un-overridable)
        if (existing.inheritance === 'sealed') continue
        if (rm.inheritance === 'sealed') {
          acc.methods[name] = rm
          continue
        }
      }
      acc.methods[name] = rm
    }
  }
  return acc
}

export function resolveAllMethods(def: Def): Record<string, ResolvedMethod> {
  const defName = getDefName(def) ?? '?'

  // Collect from parents first
  // oxlint-disable-next-line no-explicit-any
  const { methods: inherited, originsByMethod } = collectInherited(
    (def.config as { inherits?: readonly Def[] }).inherits,
  )

  // Merge own methods
  const result: Record<string, ResolvedMethod> = { ...inherited }
  // oxlint-disable-next-line no-explicit-any
  const ownMethods = (def.config as { methods?: Record<string, FnDef> }).methods
  if (ownMethods) {
    for (const [name, fnDef] of Object.entries(ownMethods)) {
      const inheritance = getInheritance(fnDef)
      const parentMethod = inherited[name]

      // Sealed override check
      if (parentMethod?.inheritance === 'sealed') {
        throw new SchemaValidationError(
          `'${defName}' cannot override sealed method '${name}' from '${parentMethod.origin}'`,
          `${defName}.methods.${name}`,
          `remove method '${name}' (sealed in '${parentMethod.origin}')`,
          `method '${name}' with ${inheritance}`,
        )
      }

      // Auto-deduce override: if parent has a default method, this is an override
      const isOverride = !!parentMethod && parentMethod.inheritance === 'default'

      // Default override: param keys must be a superset of the parent's
      if (isOverride) {
        const parentParams = getParamKeys(parentMethod.fnDef)
        const ownParams = getParamKeys(fnDef)
        const missing = parentParams.filter((k) => !ownParams.includes(k))
        if (missing.length > 0) {
          throw new SchemaValidationError(
            `'${defName}.${name}' overrides default method from '${parentMethod.origin}' but is missing param keys: ${missing.join(', ')}`,
            `${defName}.methods.${name}`,
            `add missing params: ${missing.join(', ')}`,
            `params: { ${ownParams.join(', ')} }`,
          )
        }
      }

      result[name] = { fnDef, inheritance, origin: defName, isOverride }
    }
  }

  // Diamond conflict detection (only for concrete classes, not interfaces)
  if (!(def.config as { abstract?: boolean }).abstract) {
    for (const [name, origins] of Object.entries(originsByMethod)) {
      if (origins.length > 1 && !ownMethods?.[name]) {
        const rm = result[name]
        if (rm && rm.inheritance === 'default') {
          throw new SchemaValidationError(
            `'${defName}' inherits conflicting default implementations of '${name}' from ${origins.map((o) => `'${o}'`).join(' and ')}. Must provide own implementation.`,
            `${defName}.methods.${name}`,
            `add '${name}' to '${defName}'`,
            `implicit inheritance`,
          )
        }
      }
    }
  }

  return result
}
