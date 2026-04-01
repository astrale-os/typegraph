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
} from '@astrale/typegraph-schema'

import { z } from 'zod'

import type { DefConstraints } from '../defs/constraints.js'
import type { Def, DefConfig } from '../defs/definition.js'
import type { EndpointCfg } from '../defs/endpoint.js'
import type { FnDef } from '../defs/function.js'
import type { Schema } from '../schema/schema.js'

import { getDefRegistration } from '../registry.js'
import {
  unwrapZod,
  getArrayElement,
  foldNullable,
  mapCardinality,
  hasRefTarget,
  cleanJsonSchema,
} from './helpers.js'

interface ZodRefMeta {
  __ref_target?: object
  __ref_data?: boolean
  __data_self?: boolean
  __data_grant?: boolean
  __data_target?: object
}

export class SerializeContext {
  private defToName = new Map<object, string>()
  private zodToTypeName = new WeakMap<z.ZodType, string>()
  private types: Record<string, JsonSchema> = {}
  private imports: Record<string, string> = {}

  constructor(
    private schema: Schema,
    options?: { types?: Record<string, z.ZodType> },
  ) {
    for (const [name, def] of Object.entries(schema.defs)) {
      if (def && typeof def === 'object' && 'type' in def) {
        this.defToName.set(def, name)
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

    for (const [name, def] of Object.entries(this.schema.defs)) {
      if (def.config.abstract) {
        interfaces[name] = this.serializeInterface(name, def)
      } else if (def.config.endpoints) {
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

  private serializeInterface(name: string, def: Def): InterfaceDecl {
    const { config } = def
    const result: InterfaceDecl = {
      type: 'interface',
      name,
      extends: this.resolveInherits(config),
      properties: this.serializeProperties(config.props, name),
      methods: this.serializeMethods(config.methods, name),
    }
    const data = this.serializeData(config.data)
    if (data) result.data = data
    return result
  }

  private serializeNode(name: string, def: Def): NodeDecl {
    const { config } = def
    const result: NodeDecl = {
      type: 'node',
      name,
      implements: this.resolveInherits(config),
      properties: this.serializeProperties(config.props, name),
      methods: this.serializeMethods(config.methods, name),
    }
    const data = this.serializeData(config.data)
    if (data) result.data = data
    return result
  }

  private serializeEdge(name: string, def: Def): EdgeDecl {
    const { config } = def
    const endpoints = config.endpoints!

    const result: EdgeDecl = {
      type: 'edge',
      name,
      implements: this.resolveInherits(config),
      endpoints: [this.serializeEndpoint(endpoints[0]), this.serializeEndpoint(endpoints[1])],
      properties: this.serializeProperties(config.props, name),
      methods: this.serializeMethods(config.methods, name),
    }

    const constraints = this.serializeConstraints(config.constraints)
    if (constraints) result.constraints = constraints
    return result
  }

  private resolveInherits(config: DefConfig): string[] {
    if (!config.inherits) return []
    return config.inherits.map((e) => this.getDefName(e))
  }

  private serializeEndpoint(endpoint: EndpointCfg): Endpoint {
    const result: Endpoint = {
      name: endpoint.as,
      types: endpoint.types.map((t) => this.getDefName(t as object)),
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
    props: Record<string, z.ZodType> | undefined,
    className: string,
  ): Record<string, JsonSchema> {
    if (!props) return {}
    const result: Record<string, JsonSchema> = {}
    for (const [name, schema] of Object.entries(props)) {
      result[name] = this.serializeProperty(name, schema, className)
    }
    return result
  }

  private serializeProperty(_name: string, schema: z.ZodType, _className: string): JsonSchema {
    const { inner, nullable, defaultValue, hasDefault } = unwrapZod(schema)
    let jsonSchema = this.convertZodSchema(inner)
    if (nullable) jsonSchema = foldNullable(jsonSchema)
    if (hasDefault) jsonSchema = { ...jsonSchema, default: defaultValue }
    return jsonSchema
  }

  private serializeMethods(
    methods: Record<string, FnDef> | undefined,
    className: string,
  ): Record<string, FunctionDecl> {
    if (!methods) return {}
    const result: Record<string, FunctionDecl> = {}
    for (const [name, def] of Object.entries(methods)) {
      result[name] = this.serializeFn(name, def, className)
    }
    return result
  }

  private serializeFn(name: string, def: FnDef, _className?: string): FunctionDecl {
    const { config } = def
    const { inner: returnInner, nullable: returnNullable } = unwrapZod(config.returns)

    const fn: FunctionDecl = {
      name,
      params: this.serializeParams(config.params, _className, name),
      returns: this.convertZodSchema(returnInner),
      static: config.static === true,
      inheritance: config.inheritance ?? 'default',
    }
    if (returnNullable) fn.returnsNullable = true
    if (config.stream === true) fn.stream = true
    return fn
  }

  private serializeParams(
    params: Record<string, z.ZodType> | (() => Record<string, z.ZodType>) | undefined,
    _className: string | undefined,
    _methodName: string,
  ): Record<string, JsonSchema> {
    if (!params) return {}
    const resolved = typeof params === 'function' ? params() : params
    const result: Record<string, JsonSchema> = {}

    for (const [name, schema] of Object.entries(resolved)) {
      const zodSchema = schema as z.ZodType

      if (hasRefTarget(zodSchema)) {
        result[name] = this.buildNodeRef(zodSchema)
        continue
      }

      const { inner, nullable, defaultValue, hasDefault } = unwrapZod(zodSchema)

      if (hasRefTarget(inner)) {
        let refSchema: JsonSchema = this.buildNodeRef(inner)
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

  private convertZodSchema(schema: z.ZodType): JsonSchema {
    if (hasRefTarget(schema)) return this.buildNodeRef(schema)
    if ((schema as unknown as ZodRefMeta).__data_self) return { $dataRef: 'self' }
    if ((schema as unknown as ZodRefMeta).__data_grant)
      return { $dataRef: this.getDefName((schema as unknown as ZodRefMeta).__data_target!) }

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

  private zodToJsonSchemaRaw(schema: z.ZodType): JsonSchema {
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

  private buildNodeRef(schema: z.ZodType): JsonSchema {
    const result: JsonSchema = {
      $nodeRef: this.getDefName((schema as unknown as ZodRefMeta).__ref_target!),
    }
    if ((schema as unknown as ZodRefMeta).__ref_data) result.includeData = true
    return result
  }

  private getDefName(def: object): string {
    const local = this.defToName.get(def)
    if (local) return local

    const reg = getDefRegistration(def)
    if (reg) {
      if (reg.domain && reg.domain !== this.schema.domain) {
        this.imports[reg.name] = reg.domain
      }
      return reg.name
    }

    throw new Error(
      // oxlint-disable-next-line no-explicit-any
      `Serialization error: referenced def not found in schema and not registered in any schema.`,
    )
  }
}
