// src/resolver.ts
// ============================================================
// Resolver — AST → Resolved Schema
//
// Builds a symbol table from declarations, resolves all type
// name references to their definitions, and reports unknown
// types and duplicate names.
//
// Bootstrapping:
//   1. Prelude scalars are injected first (String, Int, etc.)
//   2. The prelude source is parsed and resolved against scalars
//   3. User schemas are resolved against prelude + scalars
// ============================================================

import {
  type Schema,
  type Declaration,
  TypeAliasDecl,
  InterfaceDecl,
  NodeDecl,
  EdgeDecl,
  ExtendDecl,
  type TypeExpr,
  NamedType,
  NullableType,
  UnionType,
  EdgeRefType,
  type Name,
} from './ast.js'
import { type Span } from './tokens.js'
import { DiagnosticBag, DiagnosticCodes } from './diagnostics.js'

// ─── Resolved Schema Types ──────────────────────────────────

export type SymbolKind = 'Scalar' | 'TypeAlias' | 'Interface' | 'Class' | 'Edge'

export interface Symbol {
  name: string
  symbolKind: SymbolKind
  declaration: Declaration | null // null for builtins
  span: Span | null // null for builtins
}

export interface ResolvedSchema {
  symbols: Map<string, Symbol>
  declarations: Declaration[]
  /** Type references that have been resolved: maps Name span start → Symbol. */
  references: Map<number, Symbol>
}

export interface ResolveResult {
  schema: ResolvedSchema
  diagnostics: DiagnosticBag
}

/**
 * Resolve an AST schema against a base scope.
 *
 * @param ast - The parsed AST
 * @param baseScope - Pre-existing symbols (builtins, kernel, etc.)
 * @param diagnostics - Diagnostic bag to accumulate into
 */
export function resolve(
  ast: Schema,
  baseScope?: Map<string, Symbol>,
  diagnostics?: DiagnosticBag,
): ResolveResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const resolver = new Resolver(bag, baseScope)
  const schema = resolver.resolve(ast)
  return { schema, diagnostics: bag }
}

/**
 * Create the primal scope from a list of scalar type names.
 * This is step 0 of bootstrapping.
 */
export function createBuiltinScope(scalars: readonly string[]): Map<string, Symbol> {
  const scope = new Map<string, Symbol>()
  for (const name of scalars) {
    scope.set(name, {
      name,
      symbolKind: 'Scalar',
      declaration: null,
      span: null,
    })
  }
  return scope
}

// ────────────────────────────────────────────────────────────

class Resolver {
  private diagnostics: DiagnosticBag
  private symbols: Map<string, Symbol>
  private references: Map<number, Symbol> = new Map()

  constructor(diagnostics: DiagnosticBag, baseScope?: Map<string, Symbol>) {
    this.diagnostics = diagnostics
    // Clone base scope so we don't mutate it
    this.symbols = new Map(baseScope ?? [])
  }

  resolve(ast: Schema): ResolvedSchema {
    // Pass 1: Register all declarations (forward declaration)
    for (const decl of ast.declarations) {
      this.registerDeclaration(decl)
    }

    // Pass 2: Resolve all type references within declarations
    for (const decl of ast.declarations) {
      this.resolveDeclaration(decl)
    }

    return {
      symbols: this.symbols,
      declarations: ast.declarations,
      references: this.references,
    }
  }

  // ─── Pass 1: Registration ─────────────────────────────────

  private registerDeclaration(decl: Declaration): void {
    switch (decl.kind) {
      case 'TypeAliasDecl':
        this.registerSymbol(decl.name, 'TypeAlias', decl)
        break
      case 'InterfaceDecl':
        this.registerSymbol(decl.name, 'Interface', decl)
        break
      case 'NodeDecl':
        this.registerSymbol(decl.name, 'Class', decl)
        break
      case 'EdgeDecl':
        this.registerSymbol(decl.name, 'Edge', decl)
        break
      case 'ExtendDecl':
        // Extension imports: register as stubs
        for (const imp of decl.imports) {
          if (!this.symbols.has(imp.value)) {
            // Register as an interface placeholder (the actual kind
            // would come from fetching the remote schema; for now stub it)
            this.symbols.set(imp.value, {
              name: imp.value,
              symbolKind: 'Interface',
              declaration: null,
              span: imp.span,
            })
          }
        }
        break
    }
  }

  private registerSymbol(name: Name, kind: SymbolKind, decl: Declaration): void {
    const existing = this.symbols.get(name.value)
    if (existing) {
      // Builtins can be shadowed (e.g., user defines a class named "String" — unusual but legal)
      // Non-builtin duplicates are errors
      if (existing.declaration !== null) {
        this.diagnostics.error(
          name.span,
          DiagnosticCodes.R_DUPLICATE_NAME,
          `Duplicate declaration: '${name.value}' is already defined`,
        )
        return
      }
    }
    this.symbols.set(name.value, {
      name: name.value,
      symbolKind: kind,
      declaration: decl,
      span: name.span,
    })
  }

  // ─── Pass 2: Resolution ───────────────────────────────────

  private resolveDeclaration(decl: Declaration): void {
    switch (decl.kind) {
      case 'TypeAliasDecl':
        this.resolveTypeExpr(decl.type)
        break

      case 'InterfaceDecl':
        for (const parent of decl.extends) {
          this.resolveNameAs(parent, ['Interface'])
        }
        for (const attr of decl.attributes) {
          this.resolveTypeExpr(attr.type)
        }
        break

      case 'NodeDecl':
        for (const parent of decl.implements) {
          this.resolveNameAs(parent, ['Interface'])
        }
        for (const attr of decl.attributes) {
          this.resolveTypeExpr(attr.type)
        }
        break

      case 'EdgeDecl':
        for (const parent of decl.implements) {
          this.resolveNameAs(parent, ['Interface'])
        }
        for (const param of decl.params) {
          this.resolveTypeExpr(param.type)
        }
        for (const attr of decl.attributes) {
          this.resolveTypeExpr(attr.type)
        }
        break

      case 'ExtendDecl':
        // Already handled in registration
        break
    }
  }

  private resolveTypeExpr(expr: TypeExpr): void {
    switch (expr.kind) {
      case 'NamedType':
        this.resolveNameAs(expr.name, ['Scalar', 'TypeAlias', 'Interface', 'Class'])
        break

      case 'NullableType':
        this.resolveTypeExpr(expr.inner)
        break

      case 'UnionType':
        for (const t of expr.types) {
          this.resolveTypeExpr(t)
        }
        break

      case 'EdgeRefType':
        if (expr.target) {
          this.resolveNameAs(expr.target, ['Edge'])
        }
        // edge<any> doesn't need resolution
        break
    }
  }

  /**
   * Resolve a name reference and verify it points to an expected kind.
   */
  private resolveNameAs(name: Name, expectedKinds: SymbolKind[]): Symbol | null {
    const symbol = this.symbols.get(name.value)
    if (!symbol) {
      this.diagnostics.error(
        name.span,
        DiagnosticCodes.R_UNKNOWN_TYPE,
        `Unknown type: '${name.value}'`,
      )
      return null
    }

    // Record the resolution (for LSP go-to-definition, hover, etc.)
    this.references.set(name.span.start, symbol)

    // Enforce kind constraints
    if (!expectedKinds.includes(symbol.symbolKind)) {
      this.diagnostics.error(
        name.span,
        DiagnosticCodes.R_KIND_MISMATCH,
        `'${name.value}' is a ${symbol.symbolKind}, but expected ${expectedKinds.join(' or ')}`,
      )
    }

    return symbol
  }
}
