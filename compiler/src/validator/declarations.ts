// validator/declarations.ts
// ============================================================
// Declaration Validation
//
// Validates type aliases, interfaces, classes, and edges:
//   - Modifier placement per context
//   - Inheritance rules (classes implement interfaces only, etc.)
//   - Edge-specific rules (cardinality params, flags)
// ============================================================

import {
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type TypeAliasDecl,
  type ValueTypeDecl,
  type Method,
  type Modifier,
  type FlagModifier,
  type CardinalityModifier,
} from '../ast/index'
import { DiagnosticCodes } from '../diagnostics'
import {
  type ValidatorContext,
  EDGE_MODIFIERS,
  EDGE_FLAGS,
  ALIAS_MODIFIERS,
  modifierName,
  renderTypeExpr,
} from './index'
import { validateAttribute, validateFieldDefault } from './defaults'

export function validateDeclarations(ctx: ValidatorContext): void {
  for (const decl of ctx.schema.declarations) {
    switch (decl.kind) {
      case 'TypeAliasDecl':
        validateTypeAlias(ctx, decl)
        break
      case 'ValueTypeDecl':
        validateValueType(ctx, decl)
        break
      case 'InterfaceDecl':
        validateInterface(ctx, decl)
        break
      case 'NodeDecl':
        validateClass(ctx, decl)
        break
      case 'EdgeDecl':
        validateEdge(ctx, decl)
        break
      case 'ExtendDecl':
        // Nothing to validate beyond resolution
        break
    }
  }
}

// ─── Type Alias ────────────────────────────────────────────

function validateTypeAlias(ctx: ValidatorContext, decl: TypeAliasDecl): void {
  for (const mod of decl.modifiers) {
    if (!ALIAS_MODIFIERS.has(mod.kind)) {
      ctx.diagnostics.error(
        mod.span,
        DiagnosticCodes.V_INVALID_MODIFIER,
        `Modifier '${modifierName(mod)}' is not valid on a type alias`,
      )
    }
  }
}

// ─── Value Type ─────────────────────────────────────────────

function validateValueType(ctx: ValidatorContext, decl: ValueTypeDecl): void {
  const seen = new Set<string>()
  for (const field of decl.fields) {
    if (seen.has(field.name.value)) {
      ctx.diagnostics.error(
        field.name.span,
        DiagnosticCodes.V_DUPLICATE_FIELD,
        `Duplicate field '${field.name.value}' in value type '${decl.name.value}'`,
      )
    }
    seen.add(field.name.value)

    validateFieldDefault(ctx, field)
  }
}

// ─── Interface ─────────────────────────────────────────────

function validateInterface(ctx: ValidatorContext, decl: InterfaceDecl): void {
  // Interfaces can only extend other interfaces
  for (const parent of decl.extends) {
    const sym = ctx.schema.symbols.get(parent.value)
    if (sym && sym.symbolKind !== 'Interface') {
      ctx.diagnostics.error(
        parent.span,
        DiagnosticCodes.V_INTERFACE_IMPLEMENTS,
        `Interface '${decl.name.value}' can only extend interfaces, but '${parent.value}' is a ${sym.symbolKind}`,
      )
    }
  }

  for (const attr of decl.attributes) {
    validateAttribute(ctx, attr)
  }

  validateMethods(ctx, decl.methods)
  validateMethodOverrides(
    ctx,
    decl.name.value,
    decl.methods,
    decl.extends.map((e) => e.value),
  )
}

// ─── Class ─────────────────────────────────────────────────

function validateClass(ctx: ValidatorContext, decl: NodeDecl): void {
  // Classes can only implement interfaces
  for (const parent of decl.implements) {
    const sym = ctx.schema.symbols.get(parent.value)
    if (sym && sym.symbolKind !== 'Interface') {
      ctx.diagnostics.error(
        parent.span,
        DiagnosticCodes.V_CLASS_EXTENDS_CLASS,
        `Class '${decl.name.value}' can only implement interfaces, but '${parent.value}' is a ${sym.symbolKind}`,
      )
    }
  }

  // Node classes shouldn't have edge modifiers
  for (const mod of decl.modifiers) {
    ctx.diagnostics.warning(
      mod.span,
      DiagnosticCodes.V_INVALID_MODIFIER,
      `Modifier '${modifierName(mod)}' on a node class has no effect`,
    )
  }

  for (const attr of decl.attributes) {
    validateAttribute(ctx, attr)
  }

  validateMethods(ctx, decl.methods)
  validateMethodOverrides(
    ctx,
    decl.name.value,
    decl.methods,
    decl.implements.map((i) => i.value),
  )
}

// ─── Edge ──────────────────────────────────────────────────

function validateEdge(ctx: ValidatorContext, decl: EdgeDecl): void {
  for (const mod of decl.modifiers) {
    validateEdgeModifier(ctx, mod, decl)
  }

  for (const attr of decl.attributes) {
    validateAttribute(ctx, attr)
  }

  validateMethods(ctx, decl.methods)
  validateMethodOverrides(
    ctx,
    decl.name.value,
    decl.methods,
    decl.implements.map((i) => i.value),
  )
}

function validateEdgeModifier(ctx: ValidatorContext, mod: Modifier, decl: EdgeDecl): void {
  // Check modifier is valid in edge context
  if (!EDGE_MODIFIERS.has(mod.kind)) {
    ctx.diagnostics.error(
      mod.span,
      DiagnosticCodes.V_INVALID_MODIFIER,
      `Modifier '${modifierName(mod)}' is not valid on an edge`,
    )
    return
  }

  // Flag validation
  if (mod.kind === 'FlagModifier') {
    const flag = (mod as FlagModifier).flag
    if (!EDGE_FLAGS.has(flag)) {
      ctx.diagnostics.error(
        mod.span,
        DiagnosticCodes.V_INVALID_MODIFIER,
        `Flag '${flag}' is not valid on an edge (valid: no_self, acyclic, unique, symmetric)`,
      )
    }
  }

  // Cardinality: check bounds and param name
  if (mod.kind === 'CardinalityModifier') {
    const card = mod as CardinalityModifier

    // Verify the parameter name exists in the edge signature
    const paramNames = decl.params.map((p) => p.name.value)
    if (!paramNames.includes(card.param.value)) {
      ctx.diagnostics.error(
        card.param.span,
        DiagnosticCodes.V_INVALID_CARDINALITY,
        `Cardinality references parameter '${card.param.value}', but edge '${decl.name.value}' has parameters: ${paramNames.join(', ')}`,
      )
    }

    // Check min <= max
    if (card.max !== null && card.min > card.max) {
      ctx.diagnostics.error(
        mod.span,
        DiagnosticCodes.V_INVALID_CARDINALITY,
        `Invalid cardinality: min (${card.min}) > max (${card.max})`,
      )
    }
  }
}

// ─── Method Validation ──────────────────────────────────────

function validateMethods(ctx: ValidatorContext, methods: Method[]): void {
  const seen = new Set<string>()
  for (const method of methods) {
    if (seen.has(method.name.value)) {
      ctx.diagnostics.error(
        method.name.span,
        DiagnosticCodes.V_DUPLICATE_METHOD,
        `Duplicate method '${method.name.value}'`,
      )
    }
    seen.add(method.name.value)

    // Check for duplicate parameter names within the method
    const paramNames = new Set<string>()
    for (const param of method.params) {
      if (paramNames.has(param.name.value)) {
        ctx.diagnostics.error(
          param.name.span,
          DiagnosticCodes.V_DUPLICATE_PARAM,
          `Duplicate parameter '${param.name.value}' in method '${method.name.value}'`,
        )
      }
      paramNames.add(param.name.value)
    }
  }
}

function validateMethodOverrides(
  ctx: ValidatorContext,
  typeName: string,
  ownMethods: Method[],
  parentNames: string[],
): void {
  const inherited = collectInheritedMethods(ctx, parentNames, new Set())

  for (const method of ownMethods) {
    const parent = inherited.get(method.name.value)
    if (parent) {
      // Override: check signature compatibility (return type must match)
      const ownReturn = renderMethodReturnType(method)
      const parentReturn = renderMethodReturnType(parent.method)
      if (ownReturn !== parentReturn) {
        ctx.diagnostics.error(
          method.name.span,
          DiagnosticCodes.V_INCOMPATIBLE_OVERRIDE,
          `Method '${method.name.value}' on '${typeName}' has incompatible return type '${ownReturn}' (expected '${parentReturn}' from '${parent.source}')`,
        )
      }

      // Cannot widen access from private to public
      if (parent.method.access === 'private' && method.access === 'public') {
        ctx.diagnostics.error(
          method.name.span,
          DiagnosticCodes.V_ACCESS_WIDENING,
          `Method '${method.name.value}' on '${typeName}' cannot widen access from 'private' (inherited from '${parent.source}') to 'public'`,
        )
      }
    }
  }

  // Diamond check: look for conflicts in inherited methods
  const sourceMap = new Map<string, { method: Method; source: string }[]>()
  for (const parentName of parentNames) {
    const parentMethods = collectInheritedMethods(ctx, [parentName], new Set())
    for (const [name, entry] of parentMethods) {
      if (!sourceMap.has(name)) sourceMap.set(name, [])
      sourceMap.get(name)!.push(entry)
    }
  }

  for (const [methodName, entries] of sourceMap) {
    if (entries.length <= 1) continue
    const signatures = new Set(entries.map((e) => renderMethodReturnType(e.method)))
    if (signatures.size > 1) {
      const sources = entries.map((e) => e.source).join("', '")
      ctx.diagnostics.error(
        { start: 0, end: 0 },
        DiagnosticCodes.V_DIAMOND_CONFLICT,
        `Conflicting method '${methodName}' inherited from '${sources}' with different signatures on '${typeName}'`,
      )
    }

    const accesses = new Set(entries.map((e) => e.method.access))
    if (accesses.size > 1) {
      const sources = entries.map((e) => e.source).join("', '")
      ctx.diagnostics.error(
        { start: 0, end: 0 },
        DiagnosticCodes.V_DIAMOND_CONFLICT,
        `Conflicting access for method '${methodName}' inherited from '${sources}' on '${typeName}'`,
      )
    }
  }
}

function collectInheritedMethods(
  ctx: ValidatorContext,
  parentNames: string[],
  visited: Set<string>,
): Map<string, { method: Method; source: string }> {
  const result = new Map<string, { method: Method; source: string }>()

  for (const parentName of parentNames) {
    if (visited.has(parentName)) continue
    visited.add(parentName)

    const sym = ctx.schema.symbols.get(parentName)
    if (!sym?.declaration) continue

    const decl = sym.declaration
    let methods: Method[] = []
    let grandparents: string[] = []

    if (decl.kind === 'InterfaceDecl') {
      methods = decl.methods
      grandparents = decl.extends.map((e) => e.value)
    } else if (decl.kind === 'NodeDecl') {
      methods = decl.methods
      grandparents = decl.implements.map((i) => i.value)
    }

    // Collect grandparent methods first (so own methods override)
    const inherited = collectInheritedMethods(ctx, grandparents, visited)
    for (const [name, entry] of inherited) {
      if (!result.has(name)) result.set(name, entry)
    }

    // Own methods of the parent
    for (const method of methods) {
      result.set(method.name.value, { method, source: parentName })
    }
  }

  return result
}

function renderMethodReturnType(method: Method): string {
  const base = renderTypeExpr(method.returnType)
  if (method.returnList) return `${base}[]`
  if (method.returnNullable) return `${base}?`
  return base
}
