// ast/visitor.ts
// ============================================================
// AST Visitor / Walker Infrastructure
//
// Provides a visitor interface and a base walker class for
// traversing the AST. Phases can extend AstWalker and override
// only the methods they care about, keeping dispatch mechanical
// and exhaustive.
//
// When a new declaration kind is added:
//   1. Add it to the Declaration union in nodes.ts
//   2. Add a visit* method to AstVisitor
//   3. Add a case to walkDeclaration()
//   4. Add a default no-op to AstWalker
// The TypeScript compiler will flag any missed cases via the
// exhaustive check in walkDeclaration().
// ============================================================

import {
  type Schema,
  type Declaration,
  type TypeAliasDecl,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type ExtendDecl,
  type Attribute,
  type Param,
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type EdgeRefType,
  type Modifier,
  type Expression,
} from './nodes'

// ─── Visitor Interface ──────────────────────────────────────

export interface AstVisitor<R = void> {
  visitSchema?(schema: Schema): R
  visitTypeAlias?(decl: TypeAliasDecl): R
  visitInterface?(decl: InterfaceDecl): R
  visitNode?(decl: NodeDecl): R
  visitEdge?(decl: EdgeDecl): R
  visitExtend?(decl: ExtendDecl): R
  visitAttribute?(attr: Attribute): R
  visitParam?(param: Param): R
  visitTypeExpr?(expr: TypeExpr): R
  visitModifier?(mod: Modifier): R
  visitExpression?(expr: Expression): R
}

// ─── Walk Functions ─────────────────────────────────────────

export function walkSchema(visitor: AstVisitor, schema: Schema): void {
  visitor.visitSchema?.(schema)
  for (const decl of schema.declarations) {
    walkDeclaration(visitor, decl)
  }
}

export function walkDeclaration(visitor: AstVisitor, decl: Declaration): void {
  switch (decl.kind) {
    case 'TypeAliasDecl':
      visitor.visitTypeAlias?.(decl)
      walkTypeExpr(visitor, decl.type)
      for (const mod of decl.modifiers) visitor.visitModifier?.(mod)
      break

    case 'InterfaceDecl':
      visitor.visitInterface?.(decl)
      for (const attr of decl.attributes) walkAttribute(visitor, attr)
      break

    case 'NodeDecl':
      visitor.visitNode?.(decl)
      for (const mod of decl.modifiers) visitor.visitModifier?.(mod)
      for (const attr of decl.attributes) walkAttribute(visitor, attr)
      break

    case 'EdgeDecl':
      visitor.visitEdge?.(decl)
      for (const param of decl.params) walkParam(visitor, param)
      for (const mod of decl.modifiers) visitor.visitModifier?.(mod)
      for (const attr of decl.attributes) walkAttribute(visitor, attr)
      break

    case 'ExtendDecl':
      visitor.visitExtend?.(decl)
      break

    default: {
      const _exhaustive: never = decl
      void _exhaustive
    }
  }
}

export function walkAttribute(visitor: AstVisitor, attr: Attribute): void {
  visitor.visitAttribute?.(attr)
  walkTypeExpr(visitor, attr.type)
  for (const mod of attr.modifiers) visitor.visitModifier?.(mod)
  if (attr.defaultValue) visitor.visitExpression?.(attr.defaultValue)
}

export function walkParam(visitor: AstVisitor, param: Param): void {
  visitor.visitParam?.(param)
  walkTypeExpr(visitor, param.type)
}

export function walkTypeExpr(visitor: AstVisitor, expr: TypeExpr): void {
  visitor.visitTypeExpr?.(expr)
  switch (expr.kind) {
    case 'NullableType':
      walkTypeExpr(visitor, (expr as NullableType).inner)
      break
    case 'UnionType':
      for (const t of (expr as UnionType).types) walkTypeExpr(visitor, t)
      break
    case 'NamedType':
    case 'EdgeRefType':
      break
  }
}

// ─── Base Walker Class ──────────────────────────────────────
// Extend and override only the methods you need.

export class AstWalker implements AstVisitor {
  visitSchema(_schema: Schema): void {}
  visitTypeAlias(_decl: TypeAliasDecl): void {}
  visitInterface(_decl: InterfaceDecl): void {}
  visitNode(_decl: NodeDecl): void {}
  visitEdge(_decl: EdgeDecl): void {}
  visitExtend(_decl: ExtendDecl): void {}
  visitAttribute(_attr: Attribute): void {}
  visitParam(_param: Param): void {}
  visitTypeExpr(_expr: TypeExpr): void {}
  visitModifier(_mod: Modifier): void {}
  visitExpression(_expr: Expression): void {}

  walk(schema: Schema): void {
    walkSchema(this, schema)
  }
}
