/**
 * AST Visitor Pattern
 *
 * Enables traversing and transforming ASTs in a type-safe way.
 * Used by the compiler and optimizer.
 */

import type {
  ASTNode,
  MatchStep,
  MatchByIdStep,
  TraversalStep,
  WhereStep,
  WhereCondition,
  AliasStep,
  BranchStep,
  PathStep,
  AggregateStep,
  OrderByStep,
  LimitStep,
  SkipStep,
  DistinctStep,
  HierarchyStep,
  ReachableStep,
  ForkStep,
  PatternStep,
  SubqueryStep,
  SubqueryCondition,
  UnwindStep,
  ReturnStep,
  ProjectionExpression,
} from './types'
import type { QueryAST } from './builder'

/**
 * Visitor interface with a method for each AST node type.
 *
 * @template TContext - Context passed through the traversal
 * @template TResult - Return type of visit methods
 */
export interface ASTVisitorInterface<TContext = void, TResult = void> {
  visit?(node: ASTNode, context: TContext): TResult | undefined
  visitMatch?(node: MatchStep, context: TContext): TResult
  visitMatchById?(node: MatchByIdStep, context: TContext): TResult
  visitTraversal?(node: TraversalStep, context: TContext): TResult
  visitWhere?(node: WhereStep, context: TContext): TResult
  visitAlias?(node: AliasStep, context: TContext): TResult
  visitBranch?(node: BranchStep, context: TContext): TResult
  visitPath?(node: PathStep, context: TContext): TResult
  visitAggregate?(node: AggregateStep, context: TContext): TResult
  visitOrderBy?(node: OrderByStep, context: TContext): TResult
  visitLimit?(node: LimitStep, context: TContext): TResult
  visitSkip?(node: SkipStep, context: TContext): TResult
  visitDistinct?(node: DistinctStep, context: TContext): TResult
  visitHierarchy?(node: HierarchyStep, context: TContext): TResult
  visitReachable?(node: ReachableStep, context: TContext): TResult
  visitFork?(node: ForkStep, context: TContext): TResult
  visitPattern?(node: PatternStep, context: TContext): TResult
  visitSubqueryStep?(node: SubqueryStep, context: TContext): TResult
  visitSubqueryCondition?(condition: SubqueryCondition, context: TContext): TResult
  visitUnwind?(node: UnwindStep, context: TContext): TResult
  visitReturn?(node: ReturnStep, context: TContext): TResult
  visitExpression?(expr: ProjectionExpression, context: TContext): TResult
}

/**
 * AST Visitor base class.
 *
 * Provides default traversal behavior that can be overridden.
 */
export abstract class ASTVisitor<TContext = void, TResult = void>
  implements ASTVisitorInterface<TContext, TResult>
{
  visitMatch?(node: MatchStep, context: TContext): TResult
  visitMatchById?(node: MatchByIdStep, context: TContext): TResult
  visitTraversal?(node: TraversalStep, context: TContext): TResult
  visitWhere?(node: WhereStep, context: TContext): TResult
  visitAlias?(node: AliasStep, context: TContext): TResult
  visitBranch?(node: BranchStep, context: TContext): TResult
  visitPath?(node: PathStep, context: TContext): TResult
  visitAggregate?(node: AggregateStep, context: TContext): TResult
  visitOrderBy?(node: OrderByStep, context: TContext): TResult
  visitLimit?(node: LimitStep, context: TContext): TResult
  visitSkip?(node: SkipStep, context: TContext): TResult
  visitDistinct?(node: DistinctStep, context: TContext): TResult
  visitHierarchy?(node: HierarchyStep, context: TContext): TResult
  visitReachable?(node: ReachableStep, context: TContext): TResult
  visitFork?(node: ForkStep, context: TContext): TResult

  visitPattern?(node: PatternStep, context: TContext): TResult {
    // Default: visit inline conditions on pattern nodes and edges
    for (const patternNode of node.nodes) {
      if (patternNode.where) {
        for (const condition of patternNode.where) {
          this.visitCondition?.(condition, context)
        }
      }
    }
    for (const edge of node.edges) {
      if (edge.where) {
        for (const condition of edge.where) {
          this.visitEdgeCondition?.(condition, context)
        }
      }
    }
    return undefined as TResult
  }

  visitSubqueryStep?(node: SubqueryStep, context: TContext): TResult {
    // Default: recursively visit subquery steps
    for (const step of node.steps) {
      this.visit(step, context)
    }
    return undefined as TResult
  }

  visitSubqueryCondition?(condition: SubqueryCondition, context: TContext): TResult {
    // Default: recursively visit subquery AST
    for (const step of condition.query) {
      this.visit(step, context)
    }
    return undefined as TResult
  }

  visitUnwind?(_node: UnwindStep, _context: TContext): TResult

  visitReturn?(node: ReturnStep, context: TContext): TResult {
    // Default: visit expressions in return items
    for (const ret of node.returns) {
      if (ret.kind === 'expression') {
        this.visitExpression?.(ret.expression, context)
      }
    }
    return undefined as TResult
  }

  visitExpression?(expr: ProjectionExpression, context: TContext): TResult {
    switch (expr.type) {
      case 'computed':
        for (const operand of expr.operands) {
          this.visitExpression?.(operand, context)
        }
        break
      case 'case':
        for (const branch of expr.branches) {
          this.visitCondition?.(branch.when, context)
          this.visitExpression?.(branch.then, context)
        }
        if (expr.else) {
          this.visitExpression?.(expr.else, context)
        }
        break
      case 'function':
        for (const arg of expr.args) {
          this.visitExpression?.(arg, context)
        }
        break
    }
    return undefined as TResult
  }

  /** Visit a WHERE condition (for recursive traversal of conditions) */
  visitCondition?(condition: WhereCondition, context: TContext): TResult {
    switch (condition.type) {
      case 'logical':
        for (const subcond of condition.conditions) {
          this.visitCondition?.(subcond, context)
        }
        break
      case 'subquery':
        return this.visitSubqueryCondition?.(condition, context) as TResult
    }
    return undefined as TResult
  }

  /** Visit an edge condition (lightweight, no target) */
  visitEdgeCondition?(_condition: { field: string; operator: string; value?: unknown }, _context: TContext): TResult

  visit(node: ASTNode, context: TContext): TResult | undefined {
    switch (node.type) {
      case 'match':
        return this.visitMatch?.(node, context)
      case 'matchById':
        return this.visitMatchById?.(node, context)
      case 'traversal':
        return this.visitTraversal?.(node, context)
      case 'where':
        return this.visitWhere?.(node, context)
      case 'alias':
        return this.visitAlias?.(node, context)
      case 'branch':
        return this.visitBranch?.(node, context)
      case 'path':
        return this.visitPath?.(node, context)
      case 'aggregate':
        return this.visitAggregate?.(node, context)
      case 'orderBy':
        return this.visitOrderBy?.(node, context)
      case 'limit':
        return this.visitLimit?.(node, context)
      case 'skip':
        return this.visitSkip?.(node, context)
      case 'distinct':
        return this.visitDistinct?.(node, context)
      case 'hierarchy':
        return this.visitHierarchy?.(node, context)
      case 'reachable':
        return this.visitReachable?.(node, context)
      case 'fork':
        return this.visitFork?.(node, context)
      case 'pattern':
        return this.visitPattern?.(node, context)
      case 'subquery':
        return this.visitSubqueryStep?.(node, context)
      case 'unwind':
        return this.visitUnwind?.(node, context)
      case 'return':
        return this.visitReturn?.(node, context)
      default: {
        // Exhaustiveness check
        const _exhaustive: never = node
        // oxlint-disable-next-line no-explicit-any
        throw new Error(`Unknown AST node type: ${(node as any).type}`)
      }
    }
  }

  visitAll(ast: QueryAST, context: TContext): TResult[] {
    const results: TResult[] = []
    for (const node of ast.steps) {
      const result = this.visit(node, context)
      if (result !== undefined) {
        results.push(result)
      }
    }
    return results
  }

  protected visitBranchChildren(_node: BranchStep, _context: TContext): TResult[][] {
    throw new Error('Not implemented')
  }
}

/**
 * Visit all nodes in a QueryAST.
 */
export function visitAST<TContext, TResult>(
  ast: QueryAST,
  visitor: ASTVisitorInterface<TContext, TResult>,
  context: TContext,
): void {
  for (const step of ast.steps) {
    visitor.visit?.(step, context)
  }
}

/**
 * Visit all nodes in a step array (for subqueries).
 */
export function visitSteps<TContext, TResult>(
  steps: ASTNode[],
  visitor: ASTVisitorInterface<TContext, TResult>,
  context: TContext,
): void {
  for (const step of steps) {
    visitor.visit?.(step, context)
  }
}

/**
 * Transformer that produces a new AST.
 *
 * Each visit method can return a new node (or array of nodes) to replace
 * the original.
 */
export abstract class ASTTransformer extends ASTVisitor<void, ASTNode | ASTNode[] | null> {
  transform(_ast: QueryAST): QueryAST {
    throw new Error('Not implemented')
  }
}
