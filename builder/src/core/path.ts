/**
 * CorePath — lightweight path type for core/seed refs.
 *
 * Mirrors kernel AbsolutePath semantics but lives in the builder package
 * to avoid circular dependencies. Consumers convert via:
 *   new AbsolutePath(corePath.raw)
 */

/** Slug validation — must match kernel/core/path/grammar.ts SLUG_RE */
const SLUG_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/

export class CorePath {
  readonly raw: string

  constructor(raw: string) {
    this.raw = raw
  }

  toString(): string {
    return this.raw
  }

  valueOf(): string {
    return this.raw
  }

  [Symbol.toPrimitive](): string {
    return this.raw
  }
}

/**
 * Build a CorePath from a domain and slug segments.
 * Validates all segments against SLUG_RE.
 */
export function buildCorePath(domain: string, slugs: string[]): CorePath {
  const segments = [domain, ...slugs]
  for (const s of segments) {
    if (!SLUG_RE.test(s)) {
      throw new Error(`Invalid path slug: "${s}" — must match ${SLUG_RE}`)
    }
  }
  return new CorePath('/' + segments.join('/'))
}

export function isCorePath(value: unknown): value is CorePath {
  return value instanceof CorePath
}
