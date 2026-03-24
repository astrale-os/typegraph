/**
 * Core Definition Types
 *
 * The Core is the initial state (s₀) — a set of concrete node and edge instances
 * conforming to the schema. It is the genesis seed from which the kernel boots.
 *
 * CoreDefinition is a blueprint (no IDs). IDs come from the database at materialization.
 * CoreRefs is the resolved type with real DB IDs, used by operations at runtime.
 */

import type { NodeLabels, EdgeTypes, NodeInputProps, EdgeInputProps } from '../schema/inference'
import type { AnySchema } from '../schema/types'

// =============================================================================
// NODE & EDGE ENTRY TYPES
// =============================================================================

/**
 * Discriminated union of node entries. `kind` narrows `properties`.
 *
 * @example
 * // With schema { nodes: { user: ..., space: ... } }
 * // CoreNodeEntry<S> =
 * //   | { kind: 'user'; properties: { email: string; name: string } }
 * //   | { kind: 'space'; properties: { name: string } }
 */
export type CoreNodeEntry<S extends AnySchema> = {
  [N in NodeLabels<S>]: {
    readonly kind: N
    readonly properties: Omit<NodeInputProps<S, N>, 'id'>
  }
}[NodeLabels<S>]

/**
 * Discriminated union of edge entries. `kind` narrows `properties`.
 * `from`/`to` are constrained to node keys in the definition.
 *
 * `properties` is always optional at the type level. Required edge properties
 * are validated at runtime by Zod (at defineCore time, not deferred).
 */
export type CoreEdgeEntry<S extends AnySchema, TNodeKeys extends string> = {
  [E in EdgeTypes<S>]: {
    readonly kind: E
    readonly from: TNodeKeys
    readonly to: TNodeKeys
    readonly properties?: Omit<EdgeInputProps<S, E>, 'id'>
  }
}[EdgeTypes<S>]

// =============================================================================
// CORE DEFINITION (the blueprint)
// =============================================================================

/**
 * A validated Core definition — the genesis state blueprint.
 * No IDs. IDs are assigned when the Core is materialized into the database.
 *
 * @template S - The schema this core conforms to
 * @template TNodes - Record of ref keys to node entries (inferred from defineCore)
 */
export interface CoreDefinition<
  S extends AnySchema,
  TNodes extends Record<string, CoreNodeEntry<S>> = Record<string, CoreNodeEntry<S>>,
> {
  readonly schema: S
  readonly config: {
    readonly nodes: TNodes
    readonly edges: readonly CoreEdgeEntry<S, Extract<keyof TNodes, string>>[]
  }
}

/** Base type for CoreDefinition in generic functions. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCoreDefinition = CoreDefinition<any, any>

// =============================================================================
// CORE REFS (resolved references with real DB IDs)
// =============================================================================

/**
 * Resolved references — maps ref keys to `{ kind, id }`.
 * This is the type operations use for their dependency on Core entities.
 *
 * @example
 * function myOperation(refs: CoreRefs<typeof core>) {
 *   refs.admin.id    // string — real DB ID
 *   refs.admin.kind  // 'user' — typed
 * }
 */
export type CoreRefs<D extends AnyCoreDefinition> = {
  readonly [K in keyof D['config']['nodes']]: D['config']['nodes'][K] extends {
    kind: infer N extends string
  }
    ? { readonly kind: N; readonly id: string }
    : never
}

// =============================================================================
// SNAPSHOT (serializable representation for storage + diffing)
// =============================================================================

/**
 * Serializable representation of a Core's state.
 * Used for storing in DB and diffing on subsequent boots.
 * Contains parsed (Zod-transformed) property values, not raw input.
 *
 * Does NOT have a `config` field — this is the discriminant vs CoreDefinition.
 */
export interface CoreSnapshot {
  readonly nodes: Readonly<
    Record<
      string,
      {
        readonly kind: string
        readonly properties: Readonly<Record<string, unknown>>
      }
    >
  >
  readonly edges: readonly {
    readonly kind: string
    readonly from: string
    readonly to: string
    readonly properties?: Readonly<Record<string, unknown>>
  }[]
}

/** Accepted input for diffCore — either a snapshot or a full CoreDefinition. */
export type CoreDiffInput = CoreSnapshot | AnyCoreDefinition

// =============================================================================
// DIFF TYPES
// =============================================================================

/**
 * A single property change with schema-aware metadata.
 */
export interface PropertyChange {
  readonly property: string
  readonly oldValue: unknown
  readonly newValue: unknown
  /** Whether this property is indexed in the schema */
  readonly indexed: boolean
  /** The index type, if indexed */
  readonly indexType?: 'btree' | 'fulltext' | 'unique'
}

/**
 * The result of comparing two CoreDefinitions.
 * Classifies all changes as breaking or non-breaking.
 */
export interface CoreDiff {
  readonly nodes: {
    readonly added: readonly { refKey: string; kind: string }[]
    readonly removed: readonly { refKey: string; kind: string }[]
    readonly modified: readonly {
      refKey: string
      kind: string
      changes: readonly PropertyChange[]
    }[]
    readonly kindChanged: readonly {
      refKey: string
      oldKind: string
      newKind: string
    }[]
  }
  readonly edges: {
    readonly added: readonly { kind: string; fromKey: string; toKey: string }[]
    readonly removed: readonly { kind: string; fromKey: string; toKey: string }[]
    readonly modified: readonly {
      kind: string
      fromKey: string
      toKey: string
      changes: readonly PropertyChange[]
    }[]
  }
  /** Whether any change requires explicit resolution */
  readonly breaking: boolean
  /** Human-readable reasons for breaking changes */
  readonly breakingReasons: readonly string[]
  /** Warnings for non-breaking but notable changes (e.g. indexed property value changed) */
  readonly warnings: readonly string[]
}
