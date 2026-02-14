/**
 * Performance Module
 *
 * Exports for scalable graph generation and performance testing.
 */

// Scale configurations
export {
  type Scale,
  type ScaleConfig,
  SCALE_CONFIGS,
  estimateNodeCount,
  estimateEdgeCount,
  getScaleInfo,
  BASE_SCALE_INFO,
  SCALE_INFO_CACHE,
} from './scales'

// Graph metadata
export {
  type GraphMetadata,
  type PermissionIndex,
  type PermissionEntry,
  type GraphStats,
  type CompositionInfo,
  type GenerationProgress,
  type ProgressCallback,
  createEmptyMetadata,
  addToPermissionIndex,
  serializeMetadata,
  deserializeMetadata,
} from './graph-metadata'

// Seeded random
export { SeededRandom, createSeededRandom } from './seeded-random'

// Graph generator
export { generateScaledGraph, type GenerateOptions } from './graph-generator'

// Scenario templates and instantiation
export {
  type ScenarioTemplate,
  type NodeSelector,
  type UserSelector,
  type AppSelector,
  SCENARIO_TEMPLATES,
} from './scenario-templates'

export { instantiateScenarios, instantiateScenario } from './scenario-instantiator'

// Base scenarios
export { AVAILABLE_SCENARIOS } from './base-scenarios'
