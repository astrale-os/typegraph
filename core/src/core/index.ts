/**
 * Core Module
 *
 * Provides the Core definition system — declarative blueprints for the genesis state.
 */

export { defineCore, toCoreSnapshot } from './builders'
export type { CoreConfig } from './builders'
export { diffCore } from './diff'
export { validateEdgeTupleUniqueness } from './validation'
export type {
  CoreDefinition,
  AnyCoreDefinition,
  CoreRefs,
  CoreSnapshot,
  CoreDiffInput,
  CoreNodeEntry,
  CoreEdgeEntry,
  CoreDiff,
  PropertyChange,
} from './types'
