// resolver/scope.ts
// ============================================================
// Resolver — Symbol Table + Type Resolution
//
// Pass 1: Register all declarations (forward declaration).
// Pass 2: Resolve all type references within declarations.
// ============================================================

import {
  type Schema,
  type Declaration,
  type ValueTypeDecl,
  type TaggedUnionDecl,
  type DataDecl,
  type Method,
  type TypeExpr,
  type Name,
} from '../ast/index'
import { type Span } from '../tokens'
import { DiagnosticBag, DiagnosticCodes } from '../diagnostics'
import { type SchemaRegistry, EMPTY_REGISTRY, resolveExtendUri } from '../registry'

// ─── Resolved Schema Types ──────────────────────────────────

export type SymbolKind = 'Scalar' | 'TypeAlias' | 'ValueType' | 'TaggedUnion' | 'Interface' | 'Class' | 'Edge' | 'Data'

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
  registry?: SchemaRegistry,
  sourceUri?: string,
): ResolveResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const resolver = new Resolver(bag, baseScope, registry, sourceUri)
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
  private registry: SchemaRegistry
  private sourceUri: string | undefined

  constructor(diagnostics: DiagnosticBag, baseScope?: Map<string, Symbol>, registry?: SchemaRegistry, sourceUri?: string) {
    this.diagnostics = diagnostics
    // Clone base scope so we don't mutate it
    this.symbols = new Map(baseScope ?? [])
    this.registry = registry ?? EMPTY_REGISTRY
    this.sourceUri = sourceUri
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

    // Pass 3: Detect circular value type references
    this.detectValueTypeCycles(ast.declarations)

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
      case 'ValueTypeDecl':
        this.registerSymbol(decl.name, 'ValueType', decl)
        break
      case 'TaggedUnionDecl':
        this.registerSymbol(decl.name, 'TaggedUnion', decl)
        break
      case 'InterfaceDecl':
        this.registerSymbol(decl.name, 'Interface', decl)
        if (decl.dataDecl) this.registerSymbol(decl.dataDecl.name, 'Data', decl.dataDecl)
        break
      case 'NodeDecl':
        this.registerSymbol(decl.name, 'Class', decl)
        if (decl.dataDecl) this.registerSymbol(decl.dataDecl.name, 'Data', decl.dataDecl)
        break
      case 'EdgeDecl':
        this.registerSymbol(decl.name, 'Edge', decl)
        if (decl.dataDecl) this.registerSymbol(decl.dataDecl.name, 'Data', decl.dataDecl)
        break
      case 'DataDecl':
        this.registerSymbol(decl.name, 'Data', decl)
        break
      case 'ExtendDecl': {
        const resolvedUri = resolveExtendUri(decl.uri, this.sourceUri)
        for (const imp of decl.imports) {
          if (this.symbols.has(imp.value)) continue

          const registrySymbol = this.registry.lookupSymbol(resolvedUri, imp.value)
          if (registrySymbol) {
            // Import real symbol from the registry
            this.symbols.set(imp.value, {
              name: registrySymbol.name,
              symbolKind: registrySymbol.symbolKind,
              declaration: registrySymbol.declaration,
              span: imp.span,
            })
          } else if (this.registry.get(resolvedUri)) {
            // Schema registered but symbol not found in it
            this.diagnostics.error(
              imp.span,
              DiagnosticCodes.R_UNRESOLVED_EXTENSION,
              `Symbol '${imp.value}' not found in schema '${decl.uri}'`,
            )
          } else {
            // Schema URI not registered — fall back to stub
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

      case 'ValueTypeDecl':
        for (const field of decl.fields) {
          this.resolveTypeExpr(field.type)
        }
        break

      case 'TaggedUnionDecl':
        for (const variant of decl.variants) {
          for (const field of variant.fields) {
            this.resolveTypeExpr(field.type)
          }
        }
        break

      case 'InterfaceDecl':
        for (const parent of decl.extends) {
          this.resolveNameAs(parent, ['Interface'])
        }
        for (const attr of decl.attributes) {
          this.resolveTypeExpr(attr.type)
        }
        for (const method of decl.methods) {
          this.resolveMethod(method)
        }
        if (decl.dataDecl) this.resolveDataDeclFields(decl.dataDecl)
        if (decl.dataRef) this.resolveNameAs(decl.dataRef, ['Data'])
        break

      case 'NodeDecl':
        for (const parent of decl.implements) {
          this.resolveNameAs(parent, ['Interface'])
        }
        for (const attr of decl.attributes) {
          this.resolveTypeExpr(attr.type)
        }
        for (const method of decl.methods) {
          this.resolveMethod(method)
        }
        if (decl.dataDecl) this.resolveDataDeclFields(decl.dataDecl)
        if (decl.dataRef) this.resolveNameAs(decl.dataRef, ['Data'])
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
        for (const method of decl.methods) {
          this.resolveMethod(method)
        }
        if (decl.dataDecl) this.resolveDataDeclFields(decl.dataDecl)
        if (decl.dataRef) this.resolveNameAs(decl.dataRef, ['Data'])
        break

      case 'DataDecl':
        this.resolveDataDeclFields(decl)
        break

      case 'ExtendDecl':
        // Already handled in registration
        break
    }
  }

  private resolveMethod(method: Method): void {
    for (const param of method.params) {
      this.resolveTypeExpr(param.type)
    }
    this.resolveTypeExpr(method.returnType)
    if (method.projection?.dataRef) {
      this.resolveNameAs(method.projection.dataRef, ['Data'])
    }
  }

  private resolveDataDeclFields(decl: DataDecl): void {
    if (decl.scalarType) {
      this.resolveTypeExpr(decl.scalarType)
    }
    if (decl.fields) {
      for (const field of decl.fields) {
        this.resolveTypeExpr(field.type)
      }
    }
  }

  private resolveTypeExpr(expr: TypeExpr): void {
    switch (expr.kind) {
      case 'NamedType':
        this.resolveNameAs(expr.name, ['Scalar', 'TypeAlias', 'ValueType', 'TaggedUnion', 'Interface', 'Class', 'Data'])
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

  // ─── Cycle Detection for Value Types ─────────────────────

  private detectValueTypeCycles(declarations: Declaration[]): void {
    // Collect all value types and tagged unions (both are data types that can reference each other)
    const dataTypes = new Map<string, ValueTypeDecl | TaggedUnionDecl>()
    for (const decl of declarations) {
      if (decl.kind === 'ValueTypeDecl' || decl.kind === 'TaggedUnionDecl') {
        dataTypes.set(decl.name.value, decl)
      }
    }

    const visited = new Set<string>()
    const inStack = new Set<string>()

    const visitTypeExpr = (expr: TypeExpr): void => {
      switch (expr.kind) {
        case 'NamedType': {
          const sym = this.symbols.get(expr.name.value)
          if (sym?.symbolKind === 'ValueType' || sym?.symbolKind === 'TaggedUnion') {
            visit(expr.name.value)
          }
          break
        }
        case 'UnionType':
          for (const t of expr.types) visitTypeExpr(t)
          break
        case 'NullableType':
          visitTypeExpr(expr.inner)
          break
      }
    }

    const visit = (name: string): void => {
      if (visited.has(name)) return
      if (inStack.has(name)) {
        const decl = dataTypes.get(name)!
        this.diagnostics.error(
          decl.name.span,
          DiagnosticCodes.V_CIRCULAR_VALUE_TYPE,
          `Circular value type reference: '${name}' references itself`,
        )
        return
      }

      const decl = dataTypes.get(name)
      if (!decl) return

      inStack.add(name)
      if (decl.kind === 'ValueTypeDecl') {
        for (const field of decl.fields) {
          visitTypeExpr(field.type)
        }
      } else {
        for (const variant of decl.variants) {
          for (const field of variant.fields) {
            visitTypeExpr(field.type)
          }
        }
      }
      inStack.delete(name)
      visited.add(name)
    }

    for (const name of dataTypes.keys()) {
      visit(name)
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
