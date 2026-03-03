import type { Schema, SchemaDefsMap } from './types.js'

// ── Method name collection (walks builder config chain) ────────────────────

function collectIfaceMethodNames(def: { config?: Record<string, any> }, out: Set<string>): void {
  const cfg = def.config
  if (!cfg) return
  const parents = cfg.extends as any[] | undefined
  if (parents) {
    for (const p of parents) collectIfaceMethodNames(p, out)
  }
  const own = cfg.methods as Record<string, unknown> | undefined
  if (own) {
    for (const name of Object.keys(own)) out.add(name)
  }
}

function collectAllMethodNames(def: {
  __kind?: string
  config?: Record<string, any>
}): Set<string> {
  const out = new Set<string>()
  const cfg = def.config
  if (!cfg) return out
  const impls = cfg.implements as any[] | undefined
  if (impls) {
    for (const i of impls) collectIfaceMethodNames(i, out)
  }
  const ext = cfg.extends as { __kind?: string; config?: Record<string, any> } | undefined
  if (ext?.__kind === 'node') {
    for (const name of collectAllMethodNames(ext)) out.add(name)
  }
  const own = cfg.methods as Record<string, unknown> | undefined
  if (own) {
    for (const name of Object.keys(own)) out.add(name)
  }
  return out
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a flat typed reference map from a schema.
 *
 * Every `SchemaDefs<S>` key maps to itself — plain strings with full auto-complete.
 *
 * @example
 * ```ts
 * const refs = schemaDefs(BlogSchema)
 * refs.Author                   // 'Author'
 * refs['Author.deactivate']     // 'Author.deactivate'
 * refs['Article.publish']       // 'Article.publish' (inherited)
 * refs.wrote                    // 'wrote'
 * ```
 */
export function schemaDefs<S extends Schema>(schema: S): SchemaDefsMap<S> {
  const result: Record<string, string> = {}

  for (const [name, def] of Object.entries(schema.defs)) {
    result[name] = name

    const d = def as { __kind?: string; config?: Record<string, any> }
    if (d.__kind !== 'iface') {
      for (const methodName of collectAllMethodNames(d)) {
        const qualified = `${name}.${methodName}`
        result[qualified] = qualified
      }
    }
  }

  return result as SchemaDefsMap<S>
}
