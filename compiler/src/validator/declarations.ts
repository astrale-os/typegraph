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
} from './index'
import { validateAttribute } from './defaults'

export function validateDeclarations(ctx: ValidatorContext): void {
  for (const decl of ctx.schema.declarations) {
    switch (decl.kind) {
      case 'TypeAliasDecl':
        validateTypeAlias(ctx, decl)
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
}

// ─── Edge ──────────────────────────────────────────────────

function validateEdge(ctx: ValidatorContext, decl: EdgeDecl): void {
  for (const mod of decl.modifiers) {
    validateEdgeModifier(ctx, mod, decl)
  }

  for (const attr of decl.attributes) {
    validateAttribute(ctx, attr)
  }
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
