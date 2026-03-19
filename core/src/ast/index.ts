/**
 * AST Module
 *
 * Abstract Syntax Tree representation of graph queries.
 */

export { QueryAST } from './builder'
export type {
  ASTNode,
  MatchStep,
  MatchByIdStep,
  TraversalStep,
  WhereStep,
  BranchStep,
  PathStep,
  AggregateStep,
  OrderByStep,
  LimitStep,
  SkipStep,
  AliasStep,
  HierarchyStep,
  DistinctStep,
  ReachableStep,
  ForkStep,
  Projection,
  ProjectionType,
  WhereCondition,
  ComparisonCondition,
  LogicalCondition,
  LabelCondition,
  EdgeWhereCondition,
  ComparisonOperator,
  VariableLengthConfig,
  AliasInfo,
  AliasRegistry,
  // New v2 types
  ConditionValue,
  PatternNode,
  PatternEdge,
  PatternStep,
  SubqueryCondition,
  SubqueryExistsCondition,
  SubqueryNotExistsCondition,
  SubqueryCountCondition,
  SubqueryStep,
  AliasComparisonCondition,
  ComputedOperator,
  ProjectionExpression,
  ProjectionReturn,
  ReturnStep,
  UnwindStep,
} from './types'
export { createDefaultProjection, createEdgeProjection } from './types'
export {
  ASTVisitor,
  ASTTransformer,
  visitAST,
  visitSteps,
  type ASTVisitorInterface,
} from './visitor'
