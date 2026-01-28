/**
 * AUTH_V2 Integration Tests
 *
 * Capability-based access control system validation on FalkorDB.
 */

// Types
export * from './types'

// Core implementation
export * from './identity-evaluator'
export * from './access-checker'

// Expression builder (preferred API)
export * from './expr-builder'

// Encoding layers (explicit exports to avoid conflicts)
export { toCompact, fromCompact, toCompactJSON, fromCompactJSON } from './expr-compact'

export * from './expr-dedup'

export {
  encode,
  decode,
  encodeBase64,
  decodeBase64,
  compareSizes as binaryCompareSizes,
} from './expr-encoding'

// Test utilities (helpers have legacy identity/union/etc that conflict with expr-builder)
export * from './setup'
export {
  expectGranted,
  expectDeniedByType,
  expectDeniedByTarget,
  identities,
  subjectFromIds,
  nodeScope,
  permScope,
  principalScope,
  fullScope,
} from './helpers'
