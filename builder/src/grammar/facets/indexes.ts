/** Index strategy */
export type IndexType = 'btree' | 'unique' | 'fulltext'

/** Index definition — shorthand string or explicit config */
export type IndexDef<K extends string = string> =
  | K
  | { readonly attribute: K; readonly type: IndexType }

/** Extract the attribute name from an IndexDef */
export function indexAttribute<K extends string>(index: IndexDef<K>): K {
  return typeof index === 'string' ? index : index.attribute
}

/** Extract the index type, defaulting to 'btree' */
export function indexType(index: IndexDef): IndexType {
  return typeof index === 'string' ? 'btree' : index.type
}
