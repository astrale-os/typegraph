// src/registry.ts
// ============================================================
// Schema Registry — URI-keyed store of pre-compiled schemas
//
// Used by the resolver to import real symbols from `extend`
// declarations instead of creating blind stubs.
// ============================================================

import { resolve as pathResolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { type ResolvedSchema, type Symbol } from './resolver/index'

// ─── URI helpers ─────────────────────────────────────────────

/** Returns true if the URI is a local filesystem path (relative, absolute, or file:// URI). */
export function isLocalPath(uri: string): boolean {
  if (uri.startsWith('./') || uri.startsWith('../') || uri.startsWith('file://') || uri.startsWith('/')) {
    return true
  }
  // Windows absolute path (e.g. C:\foo\bar.gsl)
  if (/^[a-zA-Z]:[\\/]/.test(uri)) return true
  return false
}

/**
 * Resolve an extend URI to an absolute lookup key.
 *
 * - Relative paths (`./foo.gsl`, `../bar.gsl`) are resolved against the
 *   source file's directory.
 * - `file://` URIs are converted to absolute paths.
 * - Everything else (https://, etc.) is returned as-is.
 */
export function resolveExtendUri(uri: string, sourceUri?: string): string {
  if (uri.startsWith('./') || uri.startsWith('../')) {
    if (!sourceUri) return uri // can't resolve without a source
    const sourceDir = dirname(sourceUri)
    return pathResolve(sourceDir, uri)
  }
  if (uri.startsWith('file://')) {
    return fileURLToPath(uri)
  }
  return uri
}

// ─── Registry interface ──────────────────────────────────────

export interface SchemaRegistry {
  get(uri: string): ResolvedSchema | null
  register(uri: string, schema: ResolvedSchema): void
  lookupSymbol(uri: string, name: string): Symbol | null
}

export class MapSchemaRegistry implements SchemaRegistry {
  private schemas = new Map<string, ResolvedSchema>()

  get(uri: string): ResolvedSchema | null {
    return this.schemas.get(uri) ?? null
  }

  register(uri: string, schema: ResolvedSchema): void {
    this.schemas.set(uri, schema)
  }

  lookupSymbol(uri: string, name: string): Symbol | null {
    const schema = this.schemas.get(uri)
    if (!schema) return null
    return schema.symbols.get(name) ?? null
  }
}

/** Empty registry — returns null for everything. */
export const EMPTY_REGISTRY: SchemaRegistry = {
  get: () => null,
  register: () => {},
  lookupSymbol: () => null,
}

// ─── Lazy file registry ──────────────────────────────────────

/** Callback to compile a local file on demand. */
export type CompileFileFn = (absolutePath: string) => ResolvedSchema | null

/**
 * A registry that compiles local `.gsl` files on demand.
 *
 * Wraps a base MapSchemaRegistry (pre-loaded with e.g. kernel)
 * and lazily compiles local files when they are first referenced
 * via `extend "./foo.gsl"`. Cycle detection prevents infinite loops.
 */
export class LazyFileRegistry implements SchemaRegistry {
  private inner: MapSchemaRegistry
  private compileFn: CompileFileFn
  private compiling = new Set<string>()

  constructor(compileFn: CompileFileFn, base?: MapSchemaRegistry) {
    this.compileFn = compileFn
    this.inner = base ?? new MapSchemaRegistry()
  }

  get(uri: string): ResolvedSchema | null {
    const cached = this.inner.get(uri)
    if (cached) return cached

    // Only attempt on-demand compilation for local paths
    if (!isLocalPath(uri)) return null

    // Cycle detection
    if (this.compiling.has(uri)) return null

    this.compiling.add(uri)
    try {
      const schema = this.compileFn(uri)
      if (schema) {
        this.inner.register(uri, schema)
      }
      return schema
    } finally {
      this.compiling.delete(uri)
    }
  }

  register(uri: string, schema: ResolvedSchema): void {
    this.inner.register(uri, schema)
  }

  lookupSymbol(uri: string, name: string): Symbol | null {
    const schema = this.get(uri) // triggers lazy compilation if needed
    if (!schema) return null
    return schema.symbols.get(name) ?? null
  }
}
