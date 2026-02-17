/**
 * InstanceModelPass — Type-Instance Lowering
 *
 * AST-to-AST transformation that rewrites label-based node matching
 * into structural instance_of joins to class/interface nodes.
 *
 * Runs before ReifyEdgesPass in the compilation pipeline.
 * The CypherCompiler is untouched.
 */

import { QueryAST } from '../../ast'
import type {
  ASTNode,
  MatchStep,
  TraversalStep,
  WhereStep,
  WhereCondition,
  LabelCondition,
  BranchStep,
  ForkStep,
  HierarchyStep,
  AliasInfo,
  AliasRegistry,
  Projection,
} from '../../ast'
import type { SchemaShape, InstanceModelConfig } from '../../schema'
import type { CompilationPass } from '../optimizer'
import { STRUCTURAL_EDGES, META_LABELS } from './structural-edges'

export class InstanceModelPass implements CompilationPass {
  readonly name = 'InstanceModel'

  private config: InstanceModelConfig
  private clsCounter = 0

  constructor(config: InstanceModelConfig) {
    this.config = config
  }

  transform(ast: QueryAST, schema: SchemaShape): QueryAST {
    if (!this.config.enabled) return ast

    // Reset counter per transform call
    this.clsCounter = 0

    const newSteps: ASTNode[] = []
    const newAliases: AliasRegistry = new Map(ast.aliases as Map<string, AliasInfo>)

    for (const step of ast.steps) {
      switch (step.type) {
        case 'match':
          this.expandMatch(step, schema, newSteps, newAliases)
          break

        case 'matchById':
          // ID is globally unique on :Node. No join needed.
          // Just pass through — the compiler already emits {id: $p0} without labels.
          newSteps.push(step)
          break

        case 'traversal':
          this.expandTraversalTarget(step, schema, newSteps, newAliases)
          break

        case 'where':
          newSteps.push(this.rewriteWhereConditions(step, schema, newAliases))
          break

        case 'branch':
          newSteps.push(this.rewriteBranch(step, schema))
          break

        case 'fork':
          newSteps.push(this.rewriteFork(step, schema))
          break

        case 'hierarchy':
          this.expandHierarchy(step, schema, newSteps, newAliases)
          break

        default:
          newSteps.push(step)
      }
    }

    return new QueryAST(
      newSteps,
      ast.projection,
      newAliases,
      new Map(ast.userAliases as Map<string, string>),
      new Map(ast.edgeUserAliases as Map<string, string>),
      ast.aliasCounter,
      ast.currentAlias,
      ast.currentLabel,
    )
  }

  // ---------------------------------------------------------------------------
  // MatchStep expansion
  // ---------------------------------------------------------------------------

  private expandMatch(
    step: MatchStep,
    schema: SchemaShape,
    out: ASTNode[],
    aliases: AliasRegistry,
  ): void {
    const kind = this.nodeKind(schema, step.label)
    const clsAlias = this.nextClassAlias()

    // Relabel to :Node
    out.push({ ...step, label: META_LABELS.NODE })

    // instance_of traversal to class node
    out.push(this.instanceOfTraversal(step.alias, clsAlias))
    this.registerClassAlias(clsAlias, aliases)

    // WHERE on class ID
    if (kind === 'class') {
      out.push(this.classIdCondition(clsAlias, step.label))
    } else {
      out.push(this.polymorphicCondition(clsAlias, step.label))
    }
  }

  // ---------------------------------------------------------------------------
  // TraversalStep target expansion
  // ---------------------------------------------------------------------------

  private expandTraversalTarget(
    step: TraversalStep,
    schema: SchemaShape,
    out: ASTNode[],
    aliases: AliasRegistry,
  ): void {
    // If no target labels, or the step is already using structural edges, pass through
    if (
      step.toLabels.length === 0 ||
      step.toLabels[0] === META_LABELS.NODE ||
      step.toLabels[0] === META_LABELS.LINK
    ) {
      out.push(step)
      return
    }

    const targetType = step.toLabels[0]!

    // Don't rewrite if the target type isn't in the schema (e.g., already a meta-label)
    if (!schema.nodes[targetType]) {
      out.push(step)
      return
    }

    const kind = this.nodeKind(schema, targetType)
    const clsAlias = this.nextClassAlias()

    // Relabel target to :Node
    out.push({ ...step, toLabels: [META_LABELS.NODE] })

    // instance_of traversal on target
    out.push(this.instanceOfTraversal(step.toAlias, clsAlias))
    this.registerClassAlias(clsAlias, aliases)

    // WHERE on class ID
    if (kind === 'class') {
      out.push(this.classIdCondition(clsAlias, targetType))
    } else {
      out.push(this.polymorphicCondition(clsAlias, targetType))
    }
  }

  // ---------------------------------------------------------------------------
  // HierarchyStep expansion
  // ---------------------------------------------------------------------------

  private expandHierarchy(
    step: HierarchyStep,
    schema: SchemaShape,
    out: ASTNode[],
    aliases: AliasRegistry,
  ): void {
    // Relabel targetLabel if present
    if (step.targetLabel && schema.nodes[step.targetLabel]) {
      out.push({ ...step, targetLabel: META_LABELS.NODE })
    } else {
      out.push(step)
    }
  }

  // ---------------------------------------------------------------------------
  // WhereStep rewriting
  // ---------------------------------------------------------------------------

  private rewriteWhereConditions(
    step: WhereStep,
    schema: SchemaShape,
    aliases: AliasRegistry,
  ): WhereStep {
    const rewritten = step.conditions.map((c) =>
      this.rewriteCondition(c, schema, aliases),
    )
    return { type: 'where', conditions: rewritten }
  }

  private rewriteCondition(
    condition: WhereCondition,
    schema: SchemaShape,
    aliases: AliasRegistry,
  ): WhereCondition {
    switch (condition.type) {
      case 'label':
        return this.rewriteLabelCondition(condition, schema, aliases)
      case 'logical':
        return {
          ...condition,
          conditions: condition.conditions.map((c) =>
            this.rewriteCondition(c, schema, aliases),
          ),
        }
      default:
        return condition
    }
  }

  private rewriteLabelCondition(
    condition: LabelCondition,
    schema: SchemaShape,
    _aliases: AliasRegistry,
  ): WhereCondition {
    // Collect all class IDs for the requested labels
    const classIds: string[] = []
    for (const label of condition.labels) {
      if (!schema.nodes[label]) continue
      const kind = this.nodeKind(schema, label)
      if (kind === 'class') {
        const id = this.config.refs[label]
        if (id) classIds.push(id)
      } else {
        const ids = this.config.implementors[label]
        if (ids) classIds.push(...ids)
      }
    }

    if (classIds.length === 0) {
      // No matching types — this will never match.
      // Return an always-false condition.
      return {
        type: 'comparison',
        target: condition.target,
        field: 'id',
        operator: 'eq',
        value: '__never_match__',
      }
    }

    // For mode 'all' with multiple labels: a node has exactly one class,
    // so 'all' only works if the intersection of implementor sets is non-empty.
    // We already collected all matching IDs above — for 'all', we need
    // the intersection. For 'any', we need the union.
    if (condition.mode === 'all' && condition.labels.length > 1) {
      const sets = condition.labels.map((label) => {
        const kind = this.nodeKind(schema, label)
        if (kind === 'class') {
          const id = this.config.refs[label]
          return id ? new Set([id]) : new Set<string>()
        } else {
          return new Set(this.config.implementors[label] ?? [])
        }
      })
      // Intersection
      const intersection = sets.reduce((acc, set) => {
        const result = new Set<string>()
        for (const id of acc) {
          if (set.has(id)) result.add(id)
        }
        return result
      })
      if (intersection.size === 0) {
        return {
          type: 'comparison',
          target: condition.target,
          field: 'id',
          operator: 'eq',
          value: '__never_match__',
        }
      }
      // The condition target needs to reference the class node alias.
      // Since LabelCondition targets the instance node, and we need to check
      // the class node, we need a cls alias. But we can't inject traversal steps
      // from inside a condition rewrite. For now, we emit a comparison that
      // the compiler can handle — this is a known limitation.
      // TODO: expand LabelCondition into proper traversal + WHERE at step level
      const ids = [...intersection]
      return {
        type: 'comparison',
        target: condition.target,
        field: '__class_id__',
        operator: ids.length === 1 ? 'eq' : 'in',
        value: ids.length === 1 ? ids[0] : ids,
      }
    }

    // For 'any' mode or single label: union of class IDs
    const uniqueIds = [...new Set(classIds)]
    const negated = condition.negated

    return {
      type: 'comparison',
      target: condition.target,
      field: '__class_id__',
      operator: negated
        ? uniqueIds.length === 1
          ? 'neq'
          : 'notIn'
        : uniqueIds.length === 1
          ? 'eq'
          : 'in',
      value: uniqueIds.length === 1 ? uniqueIds[0] : uniqueIds,
    }
  }

  // ---------------------------------------------------------------------------
  // Branch / Fork recursion
  // ---------------------------------------------------------------------------

  private rewriteBranch(step: BranchStep, schema: SchemaShape): BranchStep {
    return {
      ...step,
      branches: step.branches.map((branch) =>
        this.transformSteps(branch, schema),
      ),
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

    for (const step of steps) {
      switch (step.type) {
        case 'match':
          this.expandMatch(step, schema, result, tempAliases)
          break
        case 'traversal':
          this.expandTraversalTarget(step, schema, result, tempAliases)
          break
        case 'where':
          result.push(this.rewriteWhereConditions(step, schema, tempAliases))
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
  // Helpers
  // ---------------------------------------------------------------------------

  private nodeKind(schema: SchemaShape, typeName: string): 'class' | 'interface' {
    const def = schema.nodes[typeName]
    if (!def) throw new Error(`InstanceModelPass: unknown type '${typeName}'`)
    return def.abstract ? 'interface' : 'class'
  }

  private nextClassAlias(): string {
    return `cls${this.clsCounter++}`
  }

  private registerClassAlias(alias: string, aliases: AliasRegistry): void {
    aliases.set(alias, {
      internalAlias: alias,
      type: 'node',
      label: `${META_LABELS.NODE}:${META_LABELS.CLASS}`,
      sourceStep: -1,
    })
  }

  private instanceOfTraversal(fromAlias: string, clsAlias: string): TraversalStep {
    return {
      type: 'traversal',
      edges: [STRUCTURAL_EDGES.INSTANCE_OF],
      direction: 'out',
      fromAlias,
      toAlias: clsAlias,
      toLabels: [META_LABELS.NODE, META_LABELS.CLASS],
      optional: false,
      cardinality: 'one',
    }
  }

  /** Match a single class node by ID */
  private classIdCondition(clsAlias: string, typeName: string): WhereStep {
    const classId = this.config.refs[typeName]
    if (!classId) {
      throw new Error(`InstanceModelPass: no ref found for type '${typeName}'`)
    }
    return {
      type: 'where',
      conditions: [
        {
          type: 'comparison',
          target: clsAlias,
          field: 'id',
          operator: 'eq',
          value: classId,
        },
      ],
    }
  }

  /** Match any class that implements an interface (by pre-resolved class IDs) */
  private polymorphicCondition(clsAlias: string, interfaceName: string): WhereStep {
    const classIds = this.config.implementors[interfaceName]
    if (!classIds?.length) {
      throw new Error(
        `InstanceModelPass: no implementors found for interface '${interfaceName}'`,
      )
    }
    return {
      type: 'where',
      conditions: [
        {
          type: 'comparison',
          target: clsAlias,
          field: 'id',
          operator: classIds.length === 1 ? 'eq' : 'in',
          value: classIds.length === 1 ? classIds[0] : classIds,
        },
      ],
    }
  }
}
