/**
 * Mutation Module
 *
 * Type-safe mutation API for graph operations.
 * Uses a MutationOp AST with compilation pipeline for pass-based transformations.
 */

// Types
export type {
  NodeInput,
  EdgeInput,
  NodeResult,
  EdgeResult,
  DeleteResult,
  MoveResult,
  SubtreeResult,
  DeleteSubtreeResult,
  CloneSubtreeResult,
  UpsertResult,
  CreateOptions,
  DeleteOptions,
  HierarchyOptions,
  CloneOptions,
  CloneSubtreeOptions,
  IdGenerator,
  GraphMutations,
  MutationTransaction,
} from './types'

export { defaultIdGenerator } from './types'

// AST
export type {
  MutationOp,
  InlineLink,
  ReifiedAnnotation,
  CreateNodeOp,
  UpdateNodeOp,
  DeleteNodeOp,
  UpsertNodeOp,
  CloneNodeOp,
  CreateEdgeOp,
  UpdateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeOp,
  DeleteEdgeByIdOp,
  MoveNodeOp,
  DeleteSubtreeOp,
  BatchCreateOp,
  BatchUpdateOp,
  BatchDeleteOp,
  BatchLinkOp,
  BatchUnlinkOp,
  UnlinkAllFromOp,
  UnlinkAllToOp,
} from './ast'

export {
  createNode,
  updateNode,
  deleteNode,
  upsertNode,
  cloneNode,
  createEdge,
  updateEdge,
  updateEdgeById,
  deleteEdge,
  deleteEdgeById,
  moveNode,
  deleteSubtree,
  batchCreate,
  batchUpdate,
  batchDelete,
  batchLink,
  batchUnlink,
  unlinkAllFrom,
  unlinkAllTo,
  MutationCompilationPipeline,
} from './ast'

export type { MutationCompilationPass } from './ast'

// Cypher Compiler
export { MutationCypherCompiler } from './cypher'
export type { CompiledMutation } from './cypher'

// Implementation
export { GraphMutationsImpl } from './impl'
export type { MutationExecutor, TransactionRunner, MutationConfig } from './impl'

// Validation
export { MutationValidator, defaultValidationOptions } from './validation'
export type { ValidationResult, ValidationIssue, ValidationOptions } from './validation'

// Hooks / Middleware
export { HooksRunner } from './hooks'
export type {
  MutationHooks,
  MutationContext,
  MutationOperation,
  BeforeCreateHook,
  AfterCreateHook,
  BeforeUpdateHook,
  AfterUpdateHook,
  BeforeDeleteHook,
  AfterDeleteHook,
  BeforeLinkHook,
  AfterLinkHook,
  BeforeUnlinkHook,
  AfterUnlinkHook,
} from './hooks'

// Dry-Run
export { DryRunBuilder, DryRunCollector } from './dry-run'
export type { DryRunResult, DryRunValidationError, DryRunOptions } from './dry-run'

// Errors
export {
  MutationError,
  NodeNotFoundError,
  EdgeExistsError,
  EdgeNotFoundError,
  CycleDetectedError,
  ParentNotFoundError,
  SourceNotFoundError,
  TransactionError,
  ValidationError,
} from './errors'
