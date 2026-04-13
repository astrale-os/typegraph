// oxlint-disable typescript/no-explicit-any
import type {
  SchemaIR,
  InterfaceDecl,
  ClassDecl,
  NodeDecl,
  EdgeDecl,
  FunctionDecl,
  Endpoint,
  EdgeConstraints,
  JsonSchema,
  PropertyDecl,
} from '@astrale/typegraph-schema'

import { z } from 'zod'

import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { DefConstraints } from '../grammar/facets/constraints.js'
import type { EndpointConfig } from '../grammar/facets/endpoints.js'
import type { Property } from '../grammar/facets/properties.js'
import type { FnDef } from '../grammar/function/def.js'
import type { Schema } from '../schema/schema.js'

import { isEdge } from '../grammar/definition/discriminants.js'
import { normalizeProperty } from '../grammar/facets/properties.js'
import { buildIdentityMap, type DefIdentity } from '../schema/refs.js'
import {
  unwrapZod,
  getArrayElement,
  foldNullable,
  mapCardinality,
  hasRefTag,
  getRefMeta,
  getDataMeta,
  hasBitmaskTag,
  cleanJsonSchema,
  type JsonSchema as InternalJsonSchema,
} from './helpers.js'

export class SerializeContext {
  private identityMap: Map<AnyDef, DefIdentity>
  private zodToTypeName = new WeakMap<z.ZodType, string>()
  private types: Record<string, JsonSchema> = {}
  private imports: Record<string, string> = {}

  constructor(
    private schema: Schema,
    options?: { types?: Record<string, z.ZodType> },
  ) {
    this.identityMap = buildIdentityMap(schema)

    // Register imported schema identities
    for (const imported of schema.imports ?? []) {
      const importedMap = buildIdentityMap(imported)
      for (const [def, identity] of importedMap) {
        this.identityMap.set(def, identity)
      }
    }

    if (options?.types) {
      for (const [name, zodSchema] of Object.entries(options.types)) {
        this.zodToTypeName.set(zodSchema, name)
        this.types[name] = this.zodToJsonSchemaRaw(zodSchema)
      }
    }
  }

  run(): SchemaIR {
    const interfaces: Record<string, InterfaceDecl> = {}
    const classes: Record<string, ClassDecl> = {}

    for (const [name, def] of Object.entries(this.schema.interfaces)) {
      interfaces[name] = this.serializeInterface(name, def)
    }

    for (const [name, def] of Object.entries(this.schema.classes)) {
      if (isEdge(def)) {
        classes[name] = this.serializeEdge(name, def)
      } else {
        classes[name] = this.serializeNode(name, def)
      }
    }

    const result: SchemaIR = {
      version: '1.0',
      domain: this.schema.domain,
      types: this.types,
      interfaces,
      classes,
    }

    if (Object.keys(this.imports).length > 0) {
      result.imports = this.imports
    }

    return result
  }

  private serializeInterface(name: string, def: AnyDef): InterfaceDecl {
    const { config } = def
    const result: InterfaceDecl = {
      type: 'interface',
      name,
      extends: this.resolveInherits(config),
      properties: this.serializeProperties(config.properties),
      methods: this.serializeMethods(config.methods, name),
    }
    const content = (config as any).content
    const data = this.serializeData(content)
    if (data) result.data = data
    return result
  }

  private serializeNode(name: string, def: AnyDef): NodeDecl {
    const { config } = def
    const result: NodeDecl = {
      type: 'node',
      name,
      implements: this.resolveInherits(config),
      properties: this.serializeProperties(config.properties),
      methods: this.serializeMethods(config.methods, name),
    }
    const content = (config as any).content
    const data = this.serializeData(content)
    if (data) result.data = data
    return result
  }

  private serializeEdge(name: string, def: AnyDef): EdgeDecl {
    const { config } = def
    const edgeDef = def as { from: EndpointConfig; to: EndpointConfig; config: typeof config }

    const result: EdgeDecl = {
      type: 'edge',
      name,
      implements: this.resolveInherits(config),
      endpoints: [this.serializeEndpoint(edgeDef.from), this.serializeEndpoint(edgeDef.to)],
      properties: this.serializeProperties(config.properties),
      methods: this.serializeMethods(config.methods, name),
    }

    const constraints = this.serializeConstraints((config as any).constraints)
    if (constraints) result.constraints = constraints
    return result
  }

  private resolveInherits(config: AnyDef['config']): string[] {
    const inherits = config.inherits as AnyDef[] | undefined
    if (!inherits) return []
    return inherits.map((e) => this.getDefName(e))
  }

  private serializeEndpoint(endpoint: EndpointConfig): Endpoint {
    const result: Endpoint = {
      name: endpoint.as,
      types: endpoint.types.map((t) => this.getDefName(t as AnyDef)),
    }
    if (endpoint.cardinality) {
      const mapped = mapCardinality(endpoint.cardinality)
      if (mapped) result.cardinality = mapped
    }
    return result
  }

  private serializeConstraints(
    constraints: DefConstraints | undefined,
  ): EdgeConstraints | undefined {
    if (!constraints) return undefined
    const c: EdgeConstraints = {}
    let has = false
    if (constraints.unique) {
      c.unique = true
      has = true
    }
    if (constraints.noSelf) {
      c.noSelf = true
      has = true
    }
    if (constraints.acyclic) {
      c.acyclic = true
      has = true
    }
    if (constraints.symmetric) {
      c.symmetric = true
      has = true
    }
    return has ? c : undefined
  }

  private serializeProperties(
    attrs: Record<string, Property> | undefined,
  ): Record<string, PropertyDecl> {
    if (!attrs) return {}
    const result: Record<string, PropertyDecl> = {}
    for (const [name, input] of Object.entries(attrs)) {
      const normalized = normalizeProperty(input)
      const decl: PropertyDecl = this.serializePropertySchema(normalized.schema)
      if (normalized.private) decl.private = true
      result[name] = decl
    }
    return result
  }

  private serializePropertySchema(schema: z.ZodType): JsonSchema {
    const { inner, nullable, defaultValue, hasDefault } = unwrapZod(schema)
    let jsonSchema = this.convertZodSchema(inner)
    if (nullable) jsonSchema = foldNullable(jsonSchema)
    if (hasDefault) jsonSchema = { ...jsonSchema, default: defaultValue }
    return jsonSchema
  }

  private serializeMethods(
    methods: Record<string, FnDef> | undefined,
    _className: string,
  ): Record<string, FunctionDecl> {
    if (!methods) return {}
    const result: Record<string, FunctionDecl> = {}
    for (const [name, def] of Object.entries(methods)) {
      result[name] = this.serializeFn(name, def)
    }
    return result
  }

  private serializeFn(name: string, def: FnDef): FunctionDecl {
    const { config } = def
    const { inner: returnInner, nullable: returnNullable } = unwrapZod(config.returns)

    const fn: FunctionDecl = {
      name,
      params: this.serializeParams(config.params),
      returns: this.convertZodSchema(returnInner),
      static: config.static ?? false,
      inheritance: config.inheritance ?? 'default',
    }
    if (returnNullable) fn.returnsNullable = true
    if (config.output && config.output !== 'value') fn.output = config.output
    return fn
  }

  private serializeParams(
    params: Record<string, z.ZodType> | (() => Record<string, z.ZodType>) | undefined,
  ): Record<string, JsonSchema> {
    if (!params) return {}
    const resolved = typeof params === 'function' ? params() : params
    const result: Record<string, JsonSchema> = {}

    for (const [name, schema] of Object.entries(resolved)) {
      const zodSchema = schema as z.ZodType

      if (hasRefTag(zodSchema)) {
        result[name] = this.buildNodeRef(zodSchema)
        continue
      }

      const { inner, nullable, defaultValue, hasDefault } = unwrapZod(zodSchema)

      if (hasRefTag(inner)) {
        let refSchema: InternalJsonSchema = this.buildNodeRef(inner)
        if (nullable) refSchema = foldNullable(refSchema)
        if (hasDefault) refSchema = { ...refSchema, default: defaultValue }
        result[name] = refSchema
        continue
      }

      let jsonSchema = this.convertZodSchema(inner)
      if (nullable) jsonSchema = foldNullable(jsonSchema)
      if (hasDefault) jsonSchema = { ...jsonSchema, default: defaultValue }
      result[name] = jsonSchema
    }
    return result
  }

  private convertZodSchema(schema: z.ZodType): InternalJsonSchema {
    if (hasRefTag(schema)) return this.buildNodeRef(schema)

    const dataMeta = getDataMeta(schema)
    if (dataMeta) {
      if (dataMeta.kind === 'self') return { $dataRef: 'self' }
      return { $dataRef: this.getDefName(dataMeta.target as AnyDef) }
    }

    if (hasBitmaskTag(schema)) return { type: 'integer', format: 'bitmask' }

    const typeName = this.zodToTypeName.get(schema)
    if (typeName) return { $ref: `#/types/${typeName}` }

    const element = getArrayElement(schema)
    if (element) {
      const itemSchema = this.convertZodSchema(element)
      if (itemSchema.$nodeRef || itemSchema.$dataRef || itemSchema.$ref) {
        return { type: 'array', items: itemSchema }
      }
    }

    return this.zodToJsonSchemaRaw(schema)
  }

  private zodToJsonSchemaRaw(schema: z.ZodType): InternalJsonSchema {
    try {
      const result = z.toJSONSchema(schema) as Record<string, unknown>
      return cleanJsonSchema(result)
    } catch {
      return {}
    }
  }

  private serializeData(data: Record<string, z.ZodType> | undefined): JsonSchema | undefined {
    if (!data || Object.keys(data).length === 0) return undefined
    const objectSchema = z.object(data as Record<string, z.ZodType>)
    const result = z.toJSONSchema(objectSchema) as Record<string, unknown>
    return cleanJsonSchema(result)
  }

  private buildNodeRef(schema: z.ZodType): InternalJsonSchema {
    const meta = getRefMeta(schema)
    if (!meta) return {}
    const result: InternalJsonSchema = {
      $nodeRef: this.getDefName(meta.target as AnyDef),
    }
    if (meta.includeData) result.includeData = true
    return result
  }

  private getDefName(def: AnyDef): string {
    const identity = this.identityMap.get(def)
    if (identity) {
      // Check if from imported schema
      for (const imported of this.schema.imports ?? []) {
        const importedMap = buildIdentityMap(imported)
        if (importedMap.has(def)) {
          this.imports[identity.name] = imported.domain
          return identity.name
        }
      }
      return identity.name
    }

    throw new Error('Serialization error: referenced def not found in schema or imports')
  }
}
