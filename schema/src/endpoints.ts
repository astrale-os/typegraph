/** An edge endpoint defining one side of a relationship. */
export interface Endpoint {
  /** Role name (e.g., 'task', 'project'). */
  name: string

  /** Allowed node type names that can connect at this endpoint. */
  types: string[]

  /** Cardinality constraint. Absent = unbounded (0..*). */
  cardinality?: Cardinality
}

/** Min/max cardinality for an edge endpoint. */
export interface Cardinality {
  min: number
  /** null = unbounded. */
  max: number | null
}

/** Structural constraints on an edge. */
export interface EdgeConstraints {
  /** At most one edge between any node pair. */
  unique?: boolean

  /** Cannot connect a node to itself. */
  noSelf?: boolean

  /** No cycles — forms a DAG. */
  acyclic?: boolean

  /** If A→B exists, B→A must also exist. */
  symmetric?: boolean

  /** Action when the source node is deleted. */
  onDeleteSource?: 'cascade' | 'unlink' | 'prevent'

  /** Action when the target node is deleted. */
  onDeleteTarget?: 'cascade' | 'unlink' | 'prevent'
}
