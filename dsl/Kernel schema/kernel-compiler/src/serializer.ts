// src/serializer.ts
// ============================================================
// Serializer — Resolved Schema → IR JSON
//
// Transforms the resolved AST declarations into the flat,
// graph-DDL-oriented IR format.
//
// All class definitions (interfaces, node classes, edges)
// go into a single `classes` array, discriminated by `type`.
// ============================================================

import {
  Declaration,
  TypeAliasDecl,
  InterfaceDecl,
  NodeDecl,
  EdgeDecl,
  ExtendDecl,
  Attribute,
  TypeExpr,
  NamedType,
  NullableType,
  UnionType,
  EdgeRefType,
  Expression,
  Modifier,
  FlagModifier,
  FormatModifier,
  MatchModifier,
  InModifier,
  LengthModifier,
  IndexedModifier,
  CardinalityModifier,
  RangeModifier,
  LifecycleModifier,
} from "./ast.js";
import {
  SchemaIR,
  TypeAlias,
  ClassDef,
  NodeDef,
  EdgeDef,
  Endpoint,
  Cardinality,
  EdgeConstraints,
  IRAttribute,
  TypeRef,
  ValueNode,
  ValueConstraints,
  AttributeModifiers,
  Extension,
} from "./ir.js";
import { ResolvedSchema, Symbol } from "./resolver.js";

export interface SerializeOptions {
  sourceHash?: string;
}

export function serialize(
  schema: ResolvedSchema,
  options?: SerializeOptions,
): SchemaIR {
  const s = new Serializer(schema);
  return s.serialize(options);
}

// ────────────────────────────────────────────────────────────

class Serializer {
  private schema: ResolvedSchema;

  constructor(schema: ResolvedSchema) {
    this.schema = schema;
  }

  private extractScalars(): string[] {
    const scalars: string[] = [];
    for (const [name, sym] of this.schema.symbols) {
      if (sym.symbolKind === "Scalar") {
        scalars.push(name);
      }
    }
    return scalars;
  }

  serialize(options?: SerializeOptions): SchemaIR {
    const extensions: Extension[] = [];
    const typeAliases: TypeAlias[] = [];
    const classes: ClassDef[] = [];

    for (const decl of this.schema.declarations) {
      switch (decl.kind) {
        case "ExtendDecl":
          extensions.push(this.serializeExtend(decl));
          break;
        case "TypeAliasDecl":
          typeAliases.push(this.serializeTypeAlias(decl));
          break;
        case "InterfaceDecl":
          classes.push(this.serializeInterface(decl));
          break;
        case "NodeDecl":
          classes.push(this.serializeClass(decl));
          break;
        case "EdgeDecl":
          classes.push(this.serializeEdge(decl));
          break;
      }
    }

    return {
      version: "1.0",
      meta: {
        generated_at: new Date().toISOString(),
        source_hash: options?.sourceHash ?? "",
      },
      extensions,
      builtin_scalars: this.extractScalars(),
      type_aliases: typeAliases,
      classes,
    };
  }

  // ─── Declarations ──────────────────────────────────────────

  private serializeExtend(decl: ExtendDecl): Extension {
    return {
      uri: decl.uri,
      imported_types: decl.imports.map((i) => i.value),
    };
  }

  private serializeTypeAlias(decl: TypeAliasDecl): TypeAlias {
    let underlyingType = "";
    if (decl.type.kind === "NamedType") {
      underlyingType = (decl.type as NamedType).name.value;
    }

    return {
      name: decl.name.value,
      underlying_type: underlyingType,
      constraints: this.extractValueConstraints(decl.modifiers),
    };
  }

  private serializeInterface(decl: InterfaceDecl): NodeDef {
    return {
      type: "node",
      name: decl.name.value,
      abstract: true,
      implements: decl.extends.map((e) => e.value),
      attributes: decl.attributes.map((a) => this.serializeAttribute(a)),
    };
  }

  private serializeClass(decl: NodeDecl): NodeDef {
    return {
      type: "node",
      name: decl.name.value,
      abstract: false,
      implements: decl.implements.map((i) => i.value),
      attributes: decl.attributes.map((a) => this.serializeAttribute(a)),
    };
  }

  private serializeEdge(decl: EdgeDecl): EdgeDef {
    // Build cardinality map from modifiers
    const cardinalityMap = new Map<string, Cardinality>();
    for (const mod of decl.modifiers) {
      if (mod.kind === "CardinalityModifier") {
        const cm = mod as CardinalityModifier;
        cardinalityMap.set(cm.param.value, { min: cm.min, max: cm.max });
      }
    }

    return {
      type: "edge",
      name: decl.name.value,
      endpoints: decl.params.map((p) => this.serializeEndpoint(p, cardinalityMap)),
      attributes: decl.attributes.map((a) => this.serializeAttribute(a)),
      constraints: this.extractEdgeConstraints(decl.modifiers),
    };
  }

  // ─── Endpoints ─────────────────────────────────────────────

  private serializeEndpoint(
    param: { name: { value: string }; type: TypeExpr },
    cardinalityMap: Map<string, Cardinality>,
  ): Endpoint {
    return {
      param_name: param.name.value,
      allowed_types: this.extractEndpointTypes(param.type),
      cardinality: cardinalityMap.get(param.name.value) ?? null,
    };
  }

  private extractEndpointTypes(expr: TypeExpr): TypeRef[] {
    switch (expr.kind) {
      case "NamedType":
        return [this.serializeTypeRef(expr)];
      case "UnionType":
        return (expr as UnionType).types.flatMap((t) => this.extractEndpointTypes(t));
      case "NullableType":
        return this.extractEndpointTypes((expr as NullableType).inner);
      case "EdgeRefType": {
        const target = (expr as EdgeRefType).target;
        if (!target) return [{ kind: "AnyEdge" }];
        return [{ kind: "Edge", name: target.value }];
      }
      default:
        return [];
    }
  }

  // ─── Attributes ────────────────────────────────────────────

  private serializeAttribute(attr: Attribute): IRAttribute {
    const result: IRAttribute = {
      name: attr.name.value,
      type: this.serializeTypeRef(attr.type),
      nullable: attr.type.kind === "NullableType",
      default: attr.defaultValue ? this.serializeValueNode(attr.defaultValue) : null,
      modifiers: this.extractAttributeModifiers(attr.modifiers),
    };
    return result;
  }

  // ─── TypeRef ───────────────────────────────────────────────

  private serializeTypeRef(expr: TypeExpr): TypeRef {
    switch (expr.kind) {
      case "NamedType": {
        const name = (expr as NamedType).name.value;
        const sym = this.schema.symbols.get(name);
        if (!sym) return { kind: "Scalar", name };
        return this.symbolToTypeRef(sym, name);
      }
      case "NullableType":
        return this.serializeTypeRef((expr as NullableType).inner);
      case "UnionType":
        return {
          kind: "Union",
          types: (expr as UnionType).types.map((t) => this.serializeTypeRef(t)),
        };
      case "EdgeRefType": {
        const target = (expr as EdgeRefType).target;
        if (!target) return { kind: "AnyEdge" };
        return { kind: "Edge", name: target.value };
      }
      default:
        return { kind: "Scalar", name: "String" };
    }
  }

  private symbolToTypeRef(sym: Symbol, name: string): TypeRef {
    switch (sym.symbolKind) {
      case "Scalar":
        return { kind: "Scalar", name };
      case "TypeAlias":
        return { kind: "Alias", name };
      case "Interface":
      case "Class":
        return { kind: "Node", name };
      case "Edge":
        return { kind: "Edge", name };
      default:
        return { kind: "Scalar", name };
    }
  }

  // ─── ValueNode ─────────────────────────────────────────────

  private serializeValueNode(expr: Expression): ValueNode {
    switch (expr.kind) {
      case "StringLiteral":
        return { kind: "StringLiteral", value: expr.value };
      case "NumberLiteral":
        return { kind: "NumberLiteral", value: expr.value };
      case "BooleanLiteral":
        return { kind: "BooleanLiteral", value: expr.value };
      case "NullLiteral":
        return { kind: "Null" };
      case "CallExpression":
        return { kind: "Call", fn: expr.fn.value, args: [] };
      default:
        return { kind: "Null" };
    }
  }

  // ─── Constraint Extraction ─────────────────────────────────

  private extractEdgeConstraints(modifiers: Modifier[]): EdgeConstraints {
    const result: EdgeConstraints = {
      no_self: false,
      acyclic: false,
      unique: false,
      symmetric: false,
    };

    for (const mod of modifiers) {
      if (mod.kind === "FlagModifier") {
        const flag = (mod as FlagModifier).flag;
        if (flag === "no_self") result.no_self = true;
        else if (flag === "acyclic") result.acyclic = true;
        else if (flag === "unique") result.unique = true;
        else if (flag === "symmetric") result.symmetric = true;
      } else if (mod.kind === "LifecycleModifier") {
        const lm = mod as LifecycleModifier;
        if (lm.event === "on_kill_source") result.on_kill_source = lm.action;
        else if (lm.event === "on_kill_target") result.on_kill_target = lm.action;
      }
    }

    return result;
  }

  private extractAttributeModifiers(modifiers: Modifier[]): AttributeModifiers {
    const result: AttributeModifiers = {};

    for (const mod of modifiers) {
      if (mod.kind === "FlagModifier") {
        const flag = (mod as FlagModifier).flag;
        if (flag === "unique") result.unique = true;
        else if (flag === "readonly") result.readonly = true;
        else if (flag === "indexed") result.indexed = true;
      } else if (mod.kind === "IndexedModifier") {
        result.indexed = (mod as IndexedModifier).direction;
      }
    }

    return result;
  }

  private extractValueConstraints(modifiers: Modifier[]): ValueConstraints | null {
    if (modifiers.length === 0) return null;

    const result: ValueConstraints = {};
    let hasAny = false;

    for (const mod of modifiers) {
      switch (mod.kind) {
        case "FormatModifier":
          result.format = (mod as FormatModifier).format as any;
          hasAny = true;
          break;
        case "MatchModifier":
          result.pattern = (mod as MatchModifier).pattern;
          hasAny = true;
          break;
        case "InModifier":
          result.enum_values = (mod as InModifier).values;
          hasAny = true;
          break;
        case "LengthModifier":
          result.length_min = (mod as LengthModifier).min;
          result.length_max = (mod as LengthModifier).max;
          hasAny = true;
          break;
        case "RangeModifier": {
          const rm = mod as RangeModifier;
          if (rm.min !== null) result.value_min = rm.min;
          if (rm.max !== null) result.value_max = rm.max;
          hasAny = true;
          break;
        }
      }
    }

    return hasAny ? result : null;
  }
}
