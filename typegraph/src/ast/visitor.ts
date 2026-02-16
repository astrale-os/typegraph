/**
 * AST Visitor Pattern
 *
 * Enables traversing and transforming ASTs in a type-safe way.
 * Used by the compiler and optimizer.
 */

import type {
  ASTNode,
  MatchStep,
  TraversalStep,
  WhereStep,
  AliasStep,
  BranchStep,
  PathStep,
  AggregateStep,
  OrderByStep,
  LimitStep,
  SkipStep,
  DistinctStep,
  HierarchyStep,
  CursorStep,
  FirstStep,
  ReachableStep,
} from './types'
import type { QueryAST } from './builder'

/**
 * Visitor interface with a method for each AST node type.
 *
 * @template TContext - Context passed through the traversal
 * @template TResult - Return type of visit methods
 */
export interface ASTVisitorInterface<TContext = void, TResult = void> {
  visitMatch?(node: MatchStep, context: TContext): TResult
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
  visitCursor?(node: CursorStep, context: TContext): TResult
  visitFirst?(node: FirstStep, context: TContext): TResult
  visitReachable?(node: ReachableStep, context: TContext): TResult
}

/**
 * AST Visitor base class.
 *
 * Provides default traversal behavior that can be overridden.
 */
export abstract class ASTVisitor<TContext = void, TResult = void> implements ASTVisitorInterface<
  TContext,
  TResult
> {
  visitMatch?(node: MatchStep, context: TContext): TResult
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
  visitCursor?(node: CursorStep, context: TContext): TResult
  visitFirst?(node: FirstStep, context: TContext): TResult
  visitReachable?(node: ReachableStep, context: TContext): TResult

  visit(node: ASTNode, context: TContext): TResult | undefined {
    switch (node.type) {
      case 'match':
        return this.visitMatch?.(node, context)
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
      case 'cursor':
        return this.visitCursor?.(node, context)
      case 'first':
        return this.visitFirst?.(node, context)
      case 'reachable':
        return this.visitReachable?.(node, context)
      default:
        return undefined
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
