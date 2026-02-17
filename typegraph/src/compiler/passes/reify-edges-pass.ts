/**
 * ReifyEdgesPass — Edge Reification Lowering
 *
 * AST-to-AST transformation that rewrites typed edge traversals into
 * link-node patterns: (A)-[:has_link]->(link:Link)-[:links_to]->(B).
 *
 * Runs after InstanceModelPass in the compilation pipeline.
 * The CypherCompiler is untouched.
 */

import { QueryAST } from '../../ast'
import type {
  ASTNode,
  TraversalStep,
  WhereStep,
  WhereCondition,
  ExistsCondition,
  ConnectedToCondition,
  BranchStep,
  ForkStep,
  AliasInfo,
  AliasRegistry,
  Projection,
} from '../../ast'
import type { SchemaShape, InstanceModelConfig } from '../../schema'
import type { CompilationPass } from '../optimizer'
import { isReified } from '../../helpers'
import { STRUCTURAL_EDGES, STRUCTURAL_EDGE_SET, META_LABELS } from './structural-edges'

export class ReifyEdgesPass implements CompilationPass {
  readonly name = 'ReifyEdges'

  private linkCounter = 0
  private lclsCounter = 0

  transform(ast: QueryAST, schema: SchemaShape): QueryAST {
    // Check if any edges are reified
    if (!this.hasReifiedEdges(schema)) return ast

    // Reset counters
    this.linkCounter = 0
    this.lclsCounter = 0

    const newSteps: ASTNode[] = []
    const newAliases: AliasRegistry = new Map(ast.aliases as Map<string, AliasInfo>)
    const edgeAliasToLinkAlias = new Map<string, string>()

    for (const step of ast.steps) {
      switch (step.type) {
        case 'traversal':
          this.expandTraversal(step, schema, newSteps, newAliases, edgeAliasToLinkAlias)
          break

        case 'where':
          newSteps.push(this.rewriteWhereConditions(step, schema))
          break

        case 'branch':
          newSteps.push(this.rewriteBranch(step, schema))
          break

        case 'fork':
          newSteps.push(this.rewriteFork(step, schema))
          break

        default:
          newSteps.push(step)
      }
    }

    // Rewrite projection: edge aliases → link node aliases
    const projection = this.rewriteProjection(ast.projection, edgeAliasToLinkAlias)

    // Rewrite edge user aliases → node user aliases for link nodes
    const newEdgeUserAliases = new Map(ast.edgeUserAliases as Map<string, string>)
    const newUserAliases = new Map(ast.userAliases as Map<string, string>)
    for (const [userAlias, internalAlias] of newEdgeUserAliases) {
      const linkAlias = edgeAliasToLinkAlias.get(internalAlias)
      if (linkAlias) {
        // Edge user alias now points to the link node
        newUserAliases.set(userAlias, linkAlias)
        newEdgeUserAliases.delete(userAlias)
      }
    }

    return new QueryAST(
      newSteps,
      projection,
      newAliases,
      newUserAliases,
      newEdgeUserAliases,
      ast.aliasCounter,
      ast.currentAlias,
      ast.currentLabel,
    )
  }

  // ---------------------------------------------------------------------------
  // TraversalStep expansion
  // ---------------------------------------------------------------------------

  private expandTraversal(
    step: TraversalStep,
    schema: SchemaShape,
    out: ASTNode[],
    aliases: AliasRegistry,
    edgeAliasToLinkAlias: Map<string, string>,
  ): void {
    // Only reify if ALL edges in the step are reified
    const shouldReify = step.edges.every(
      (e) => !STRUCTURAL_EDGE_SET.has(e) && isReified(schema, e),
    )

    if (!shouldReify) {
      out.push(step)
      return
    }

    // Reject variable-length paths on reified edges
    if (step.variableLength) {
      throw new Error(
        `ReifyEdgesPass: variable-length traversal on reified edge '${step.edges.join('|')}' is not supported. ` +
          `Use fixed-hop traversals or compose explicit paths.`,
      )
    }

    // Reject bidirectional
    if (step.direction === 'both') {
      throw new Error(
        `ReifyEdgesPass: bidirectional traversal on reified edge '${step.edges.join('|')}' is not supported. ` +
          `Use explicit directional queries.`,
      )
    }

    const linkAlias = this.nextLinkAlias()
    const instanceModel = schema.instanceModel

    // Track edge alias → link alias mapping
    if (step.edgeAlias) {
      edgeAliasToLinkAlias.set(step.edgeAlias, linkAlias)
    }

    // Register link alias
    aliases.set(linkAlias, {
      internalAlias: linkAlias,
      type: 'node',
      label: META_LABELS.LINK,
      sourceStep: -1,
    })

    if (step.direction === 'out') {
      this.expandOutbound(step, linkAlias, instanceModel, out, aliases)
    } else {
      this.expandInbound(step, linkAlias, instanceModel, out, aliases)
    }
  }

  private expandOutbound(
    step: TraversalStep,
    linkAlias: string,
    instanceModel: InstanceModelConfig | undefined,
    out: ASTNode[],
    aliases: AliasRegistry,
  ): void {
    const linkLabel = this.resolveLinkLabel(step.edges[0]!, instanceModel)

    // Hop 1: source → link via has_link
    out.push({
      type: 'traversal',
      edges: [STRUCTURAL_EDGES.HAS_LINK],
      direction: 'out',
      fromAlias: step.fromAlias,
      toAlias: linkAlias,
      toLabels: [linkLabel],
      optional: step.optional,
      cardinality: 'many',
    } satisfies TraversalStep)

    // Link type discrimination via instance_of (when instance model enabled)
    this.addLinkTypeFilter(step.edges[0]!, linkAlias, instanceModel, out, aliases)

    // Edge WHERE conditions → node WHERE on link
    if (step.edgeWhere?.length) {
      out.push({
        type: 'where',
        conditions: step.edgeWhere.map((ew) => ({
          type: 'comparison' as const,
          target: linkAlias,
          field: ew.field,
          operator: ew.operator,
          value: ew.value,
        })),
      } satisfies WhereStep)
    }

    // Hop 2: link → target via links_to
    out.push({
      type: 'traversal',
      edges: [STRUCTURAL_EDGES.LINKS_TO],
      direction: 'out',
      fromAlias: linkAlias,
      toAlias: step.toAlias,
      toLabels: step.toLabels,
      optional: step.optional,
      cardinality: 'one',
    } satisfies TraversalStep)
  }

  private expandInbound(
    step: TraversalStep,
    linkAlias: string,
    instanceModel: InstanceModelConfig | undefined,
    out: ASTNode[],
    aliases: AliasRegistry,
  ): void {
    const linkLabel = this.resolveLinkLabel(step.edges[0]!, instanceModel)

    // Hop 1: target ← link via links_to (reversed)
    out.push({
      type: 'traversal',
      edges: [STRUCTURAL_EDGES.LINKS_TO],
      direction: 'in',
      fromAlias: step.fromAlias,
      toAlias: linkAlias,
      toLabels: [linkLabel],
      optional: step.optional,
      cardinality: 'many',
    } satisfies TraversalStep)

    // Link type discrimination
    this.addLinkTypeFilter(step.edges[0]!, linkAlias, instanceModel, out, aliases)

    // Edge WHERE conditions → node WHERE on link
    if (step.edgeWhere?.length) {
      out.push({
        type: 'where',
        conditions: step.edgeWhere.map((ew) => ({
          type: 'comparison' as const,
          target: linkAlias,
          field: ew.field,
          operator: ew.operator,
          value: ew.value,
        })),
      } satisfies WhereStep)
    }

    // Hop 2: link ← source via has_link (reversed)
    out.push({
      type: 'traversal',
      edges: [STRUCTURAL_EDGES.HAS_LINK],
      direction: 'in',
      fromAlias: linkAlias,
      toAlias: step.toAlias,
      toLabels: step.toLabels,
      optional: step.optional,
      cardinality: 'one',
    } satisfies TraversalStep)
  }

  // ---------------------------------------------------------------------------
  // Link type filtering
  // ---------------------------------------------------------------------------

  private addLinkTypeFilter(
    edgeType: string,
    linkAlias: string,
    instanceModel: InstanceModelConfig | undefined,
    out: ASTNode[],
    aliases: AliasRegistry,
  ): void {
    if (!instanceModel?.enabled) return // Label discrimination is already handled via toLabels

    const lclsAlias = this.nextLinkClassAlias()
    aliases.set(lclsAlias, {
      internalAlias: lclsAlias,
      type: 'node',
      label: `${META_LABELS.NODE}:${META_LABELS.CLASS}`,
      sourceStep: -1,
    })

    // instance_of traversal on link node → class node
    out.push({
      type: 'traversal',
      edges: [STRUCTURAL_EDGES.INSTANCE_OF],
      direction: 'out',
      fromAlias: linkAlias,
      toAlias: lclsAlias,
      toLabels: [META_LABELS.NODE, META_LABELS.CLASS],
      optional: false,
      cardinality: 'one',
    } satisfies TraversalStep)

    // WHERE on link class ID
    const classId = instanceModel.refs[edgeType]
    if (!classId) {
      throw new Error(
        `ReifyEdgesPass: no class ref found for edge type '${edgeType}'`,
      )
    }
    out.push({
      type: 'where',
      conditions: [
        {
          type: 'comparison',
          target: lclsAlias,
          field: 'id',
          operator: 'eq',
          value: classId,
        },
      ],
    } satisfies WhereStep)
  }

  // ---------------------------------------------------------------------------
  // Where condition rewriting
  // ---------------------------------------------------------------------------

  private rewriteWhereConditions(
    step: WhereStep,
    schema: SchemaShape,
  ): WhereStep {
    const rewritten = step.conditions.map((c) => this.rewriteCondition(c, schema))
    return { type: 'where', conditions: rewritten }
  }

  private rewriteCondition(condition: WhereCondition, schema: SchemaShape): WhereCondition {
    switch (condition.type) {
      case 'exists':
        return this.rewriteExistsCondition(condition, schema)
      case 'connectedTo':
        return this.rewriteConnectedToCondition(condition, schema)
      case 'logical':
        return {
          ...condition,
          conditions: condition.conditions.map((c) => this.rewriteCondition(c, schema)),
        }
      default:
        return condition
    }
  }

  private rewriteExistsCondition(condition: ExistsCondition, schema: SchemaShape): WhereCondition {
    if (STRUCTURAL_EDGE_SET.has(condition.edge)) return condition
    if (!isReified(schema, condition.edge)) return condition

    // Rewrite: EXISTS (n)-[:edge]->() → EXISTS (n)-[:has_link]->()
    // With instance model, we'd need label filtering on the link, which
    // EXISTS doesn't support natively. For now, use has_link only.
    return {
      ...condition,
      edge: STRUCTURAL_EDGES.HAS_LINK,
    }
  }

  private rewriteConnectedToCondition(
    condition: ConnectedToCondition,
    schema: SchemaShape,
  ): WhereCondition {
    if (STRUCTURAL_EDGE_SET.has(condition.edge)) return condition
    if (!isReified(schema, condition.edge)) return condition

    // ConnectedTo on reified edges: the pattern becomes a two-hop through link.
    // Since ConnectedToCondition compiles to a MATCH pattern, we can't easily
    // express two hops. For now, rewrite to has_link and note the limitation.
    // TODO: convert to two TraversalSteps + WHERE id check at step level
    return {
      ...condition,
      edge: STRUCTURAL_EDGES.HAS_LINK,
    }
  }

  // ---------------------------------------------------------------------------
  // Branch / Fork recursion
  // ---------------------------------------------------------------------------

  private rewriteBranch(step: BranchStep, schema: SchemaShape): BranchStep {
    return {
      ...step,
      branches: step.branches.map((branch) => this.transformSteps(branch, schema)),
    }
  }

  private rewriteFork(step: ForkStep, schema: SchemaShape): ForkStep {
    return {
      ...step,
      branches: step.branches.map((branch) => ({
        ...branch,
        steps: this.transformSteps(branch.steps, schema),
      })),
    }
  }

  private transformSteps(steps: ASTNode[], schema: SchemaShape): ASTNode[] {
    const result: ASTNode[] = []
    const tempAliases: AliasRegistry = new Map()
    const tempEdgeMap = new Map<string, string>()

    for (const step of steps) {
      switch (step.type) {
        case 'traversal':
          this.expandTraversal(step, schema, result, tempAliases, tempEdgeMap)
          break
        case 'where':
          result.push(this.rewriteWhereConditions(step, schema))
          break
        case 'branch':
          result.push(this.rewriteBranch(step as BranchStep, schema))
          break
        case 'fork':
          result.push(this.rewriteFork(step as ForkStep, schema))
          break
        default:
          result.push(step)
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Projection rewriting
  // ---------------------------------------------------------------------------

  private rewriteProjection(
    projection: import('../../ast').Projection,
    edgeAliasToLinkAlias: Map<string, string>,
  ): import('../../ast').Projection {
    if (edgeAliasToLinkAlias.size === 0) return projection

    // Move edge aliases that map to link nodes into node aliases
    const newNodeAliases = [...projection.nodeAliases]
    const newEdgeAliases = projection.edgeAliases.filter((ea) => {
      const linkAlias = edgeAliasToLinkAlias.get(ea)
      if (linkAlias) {
        newNodeAliases.push(linkAlias)
        return false // remove from edge aliases
      }
      return true
    })

    // Update projection type if needed
    let type = projection.type
    if (type === 'edge' || type === 'edgeCollection') {
      if (newEdgeAliases.length === 0) {
        type = type === 'edge' ? 'node' : 'collection'
      }
    }

    return {
      ...projection,
      type,
      nodeAliases: newNodeAliases,
      edgeAliases: newEdgeAliases,
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private hasReifiedEdges(schema: SchemaShape): boolean {
    if (schema.reifyEdges) return true
    return Object.values(schema.edges).some((e) => e.reified === true)
  }

  private nextLinkAlias(): string {
    return `link${this.linkCounter++}`
  }

  private nextLinkClassAlias(): string {
    return `lcls${this.lclsCounter++}`
  }

  private resolveLinkLabel(
    edgeType: string,
    instanceModel: InstanceModelConfig | undefined,
  ): string {
    if (instanceModel?.enabled) {
      return META_LABELS.LINK
    }
    // Capitalize first letter, preserving camelCase: 'orderItem' → 'OrderItem'
    return edgeType.charAt(0).toUpperCase() + edgeType.slice(1)
  }
}
