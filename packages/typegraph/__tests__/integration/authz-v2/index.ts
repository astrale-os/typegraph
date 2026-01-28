/**
 * AUTH_V2 Integration Tests
 *
 * Capability-based access control system validation on FalkorDB.
 */

// Types
export * from './types'

// Expression domain
export * from './expression'

// Authorization domain
export * from './authorization'

// Adapter domain
export {
  FalkorDBIdentityAdapter,
  createFalkorDBIdentityAdapter,
  AccessChecker,
  createAccessChecker,
} from './adapter'
export {
  IdentityEvaluator,
  CycleDetectedError,
  InvalidIdentityError,
} from './adapter/identity-evaluator'

// Authentication domain
export * from './authentication'

// SDK
export * from './sdk'

// Testing utilities
export {
  setupAuthzTest,
  teardownAuthzTest,
  clearDatabase,
  seedAuthzTestData,
} from './testing/setup'
export {
  expectGranted,
  expectDeniedByType,
  expectDeniedByResource,
  identities,
  grantFromIds,
  nodeScope,
  permScope,
  principalScope,
  fullScope,
} from './testing/helpers'
