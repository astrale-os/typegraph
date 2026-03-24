// src/file-resolver.ts
// ============================================================
// Lazy File Registry Factory
//
// Bridges the gap between registry.ts and compile.ts to avoid
// circular imports. Creates a LazyFileRegistry that compiles
// local .gsl files on demand when encountered in `extend`.
// ============================================================

import { readFileSync } from 'fs'

import { compile } from './compile'
import { type Prelude, DEFAULT_PRELUDE } from './prelude'
import { LazyFileRegistry, type MapSchemaRegistry } from './registry'

export function createLazyFileRegistry(
  base?: MapSchemaRegistry,
  prelude?: Prelude,
): LazyFileRegistry {
  const pre = prelude ?? DEFAULT_PRELUDE

  const registry: LazyFileRegistry = new LazyFileRegistry((absolutePath) => {
    let source: string
    try {
      source = readFileSync(absolutePath, 'utf-8')
    } catch {
      return null
    }

    const { artifacts } = compile(source, {
      prelude: pre,
      registry,
      sourceUri: absolutePath,
      skipSerialization: true,
    })

    return artifacts?.resolved ?? null
  }, base)

  return registry
}
