/**
 * Mutation Module
 *
 * Type-safe mutation API for graph operations.
 * Supports pluggable template providers for different query languages.
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
} from "./types"

export { defaultIdGenerator } from "./types"

// Template Provider Interface
export type {
  MutationTemplateProvider,
  NodeTemplateProvider,
  EdgeTemplateProvider,
  HierarchyTemplateProvider,
  BatchTemplateProvider,
  TemplateUtils,
} from "./template-provider"

// Implementation
export { GraphMutationsImpl } from "./mutations"
export type { MutationExecutor, TransactionRunner, MutationConfig } from "./mutations"

// Cypher Templates (default)
export { CypherTemplates } from "./cypher"

// Validation
export { MutationValidator, defaultValidationOptions } from "./validation"
export type { ValidationResult, ValidationIssue, ValidationOptions } from "./validation"

// Hooks / Middleware
export { HooksRunner } from "./hooks"
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
} from "./hooks"

// Dry-Run
export { DryRunBuilder, DryRunCollector } from "./dry-run"
export type { DryRunResult, DryRunValidationError, DryRunOptions } from "./dry-run"

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
} from "./errors"
