// serializer/index.ts
// ============================================================
// Serializer — Resolved Schema → IR JSON
//
// Transforms the resolved AST declarations into the flat,
// graph-DDL-oriented IR format.
//
// All class definitions (interfaces, nodes, edges)
// go into a single `classes` array, discriminated by `type`.
// ============================================================

import {
  type SchemaIR,
  type TypeAlias,
  type ValueTypeDef,
  type TaggedUnionDef,
  type DataTypeDef,
  type ClassDef,
  type Extension,
} from '../ir/index'
import { type ResolvedSchema } from '../resolver/index'
import type {
  TypeAliasDecl,
  ValueTypeDecl,
  TaggedUnionDecl,
  InterfaceDecl,
  NodeDecl,
  EdgeDecl,
  DataDecl,
} from '../ast/index'
import { isLocalPath } from '../registry'
import {
  serializeExtend,
  serializeTypeAlias,
  serializeValueType,
  serializeTaggedUnion,
  serializeDataType,
  serializeInterface,
  serializeNode,
  serializeEdge,
} from './declarations'

export interface SerializeOptions {
  sourceHash?: string
}

export function serialize(schema: ResolvedSchema, options?: SerializeOptions): SchemaIR {
  const ctx: SerializerContext = { schema }
  return serializeSchema(ctx, options)
}

// ─── Shared Context ─────────────────────────────────────────

export interface SerializerContext {
  readonly schema: ResolvedSchema
}

// ─── Schema Serialization ───────────────────────────────────

function serializeSchema(ctx: SerializerContext, options?: SerializeOptions): SchemaIR {
  const extensions: Extension[] = []
  const typeAliases: TypeAlias[] = []
  const valueTypes: ValueTypeDef[] = []
  const taggedUnions: TaggedUnionDef[] = []
  const dataTypes: DataTypeDef[] = []
  const classes: ClassDef[] = []

  for (const decl of ctx.schema.declarations) {
    switch (decl.kind) {
      case 'ExtendDecl':
        extensions.push(serializeExtend(decl))
        break
      case 'TypeAliasDecl':
        typeAliases.push(serializeTypeAlias(ctx, decl))
        break
      case 'ValueTypeDecl':
        valueTypes.push(serializeValueType(ctx, decl))
        break
      case 'TaggedUnionDecl':
        taggedUnions.push(serializeTaggedUnion(ctx, decl))
        break
      case 'DataDecl':
        dataTypes.push(serializeDataType(ctx, decl))
        break
      case 'InterfaceDecl':
        classes.push(serializeInterface(ctx, decl))
        break
      case 'NodeDecl':
        classes.push(serializeNode(ctx, decl))
        break
      case 'EdgeDecl':
        classes.push(serializeEdge(ctx, decl))
        break
    }
  }

  // Emit imported definitions from extend declarations so the IR is self-contained.
  // Without this, `extend "./a.gsl" { Foo }` would only record Foo's name in the
  // Extension record but not its actual definition, leaving codegen blind to it.
  const emittedNames = new Set([
    ...typeAliases.map((a) => a.name),
    ...valueTypes.map((v) => v.name),
    ...taggedUnions.map((t) => t.name),
    ...classes.map((c) => c.name),
  ])

  for (const decl of ctx.schema.declarations) {
    if (decl.kind !== 'ExtendDecl') continue
    // Only emit definitions from local file extends (e.g. "./a.gsl"),
    // not from remote/kernel extends (e.g. "https://kernel.astrale.ai/v1").
    if (!isLocalPath(decl.uri)) continue
    for (const imp of decl.imports) {
      if (emittedNames.has(imp.value)) continue
      const sym = ctx.schema.symbols.get(imp.value)
      if (!sym?.declaration) continue // builtin or stub — skip
      emittedNames.add(imp.value)
      switch (sym.declaration.kind) {
        case 'TypeAliasDecl':
          typeAliases.push(serializeTypeAlias(ctx, sym.declaration as TypeAliasDecl))
          break
        case 'ValueTypeDecl':
          valueTypes.push(serializeValueType(ctx, sym.declaration as ValueTypeDecl))
          break
        case 'TaggedUnionDecl':
          taggedUnions.push(serializeTaggedUnion(ctx, sym.declaration as TaggedUnionDecl))
          break
        case 'InterfaceDecl':
          classes.push(serializeInterface(ctx, sym.declaration as InterfaceDecl))
          break
        case 'NodeDecl':
          classes.push(serializeNode(ctx, sym.declaration as NodeDecl))
          break
        case 'EdgeDecl':
          classes.push(serializeEdge(ctx, sym.declaration as EdgeDecl))
          break
        case 'DataDecl':
          dataTypes.push(serializeDataType(ctx, sym.declaration as DataDecl))
          break
      }
    }
  }

  // Also collect inline data decls from class bodies
  for (const decl of ctx.schema.declarations) {
    if (
      (decl.kind === 'NodeDecl' || decl.kind === 'InterfaceDecl' || decl.kind === 'EdgeDecl') &&
      decl.dataDecl
    ) {
      dataTypes.push(serializeDataType(ctx, decl.dataDecl))
    }
  }

  // Extract scalars
  const builtinScalars: string[] = []
  for (const [name, sym] of ctx.schema.symbols) {
    if (sym.symbolKind === 'Scalar') {
      builtinScalars.push(name)
    }
  }

  return {
    version: '1.0',
    meta: {
      generated_at: new Date().toISOString(),
      source_hash: options?.sourceHash ?? '',
    },
    extensions,
    builtin_scalars: builtinScalars,
    type_aliases: typeAliases,
    value_types: valueTypes,
    tagged_unions: taggedUnions,
    data_types: dataTypes,
    classes,
  }
}
