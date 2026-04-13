/**
 * CorePath — a branded string representing a slash-delimited path to a core instance.
 * Example: "/my-domain.com/admin/system-class"
 */
export type CorePath = string & { readonly __brand: unique symbol }

const SLUG_RE = /^[a-z][a-z0-9-]*$/

/** Build a CorePath from a domain and slug segments */
export function buildCorePath(domain: string, slugs: readonly string[]): CorePath {
  for (const slug of slugs) {
    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `Invalid core path slug '${slug}': must be lowercase alphanumeric with hyphens, starting with a letter`,
      )
    }
  }
  return `/${domain}/${slugs.join('/')}` as CorePath
}

/** Check if a value is a CorePath */
export function isCorePath(value: unknown): value is CorePath {
  return typeof value === 'string' && value.startsWith('/')
}
