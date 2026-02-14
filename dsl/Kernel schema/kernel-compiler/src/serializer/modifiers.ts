// serializer/modifiers.ts
// ============================================================
// Constraint & Modifier Extraction
//
// Extracts IR constraint objects from AST modifier arrays:
// EdgeConstraints, AttributeModifiers, ValueConstraints
// ============================================================

import {
  type Modifier,
  type FlagModifier,
  type FormatModifier,
  type MatchModifier,
  type InModifier,
  type LengthModifier,
  type RangeModifier,
  type LifecycleModifier,
  type IndexedModifier,
} from '../ast/index.js'
import {
  type EdgeConstraints,
  type AttributeModifiers,
  type ValueConstraints,
} from '../ir/index.js'

export function extractEdgeConstraints(modifiers: Modifier[]): EdgeConstraints {
  const result: EdgeConstraints = {
    no_self: false,
    acyclic: false,
    unique: false,
    symmetric: false,
  }

  for (const mod of modifiers) {
    if (mod.kind === 'FlagModifier') {
      const flag = (mod as FlagModifier).flag
      if (flag === 'no_self') result.no_self = true
      else if (flag === 'acyclic') result.acyclic = true
      else if (flag === 'unique') result.unique = true
      else if (flag === 'symmetric') result.symmetric = true
    } else if (mod.kind === 'LifecycleModifier') {
      const lm = mod as LifecycleModifier
      if (lm.event === 'on_kill_source') result.on_kill_source = lm.action
      else if (lm.event === 'on_kill_target') result.on_kill_target = lm.action
    }
  }

  return result
}

export function extractAttributeModifiers(modifiers: Modifier[]): AttributeModifiers {
  const result: AttributeModifiers = {}

  for (const mod of modifiers) {
    if (mod.kind === 'FlagModifier') {
      const flag = (mod as FlagModifier).flag
      if (flag === 'unique') result.unique = true
      else if (flag === 'readonly') result.readonly = true
      else if (flag === 'indexed') result.indexed = true
    } else if (mod.kind === 'IndexedModifier') {
      result.indexed = (mod as IndexedModifier).direction
    }
  }

  return result
}

export function extractValueConstraints(modifiers: Modifier[]): ValueConstraints | null {
  if (modifiers.length === 0) return null

  const result: ValueConstraints = {}
  let hasAny = false

  for (const mod of modifiers) {
    switch (mod.kind) {
      case 'FormatModifier':
        result.format = (mod as FormatModifier).format as any
        hasAny = true
        break
      case 'MatchModifier':
        result.pattern = (mod as MatchModifier).pattern
        hasAny = true
        break
      case 'InModifier':
        result.enum_values = (mod as InModifier).values
        hasAny = true
        break
      case 'LengthModifier':
        result.length_min = (mod as LengthModifier).min
        result.length_max = (mod as LengthModifier).max
        hasAny = true
        break
      case 'RangeModifier': {
        const rm = mod as RangeModifier
        if (rm.min !== null) result.value_min = rm.min
        if (rm.max !== null) result.value_max = rm.max
        hasAny = true
        break
      }
    }
  }

  return hasAny ? result : null
}
