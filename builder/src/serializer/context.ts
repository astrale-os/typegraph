import { z } from 'zod'
import type { Schema } from '../schema/schema.js'
import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'
import type { OpDef } from '../defs/op.js'
import type { EndpointCfg } from '../defs/edge.js'
import { getDefRegistration } from '../registry.js'
import type {
  SchemaIR,
  ClassDecl,
  NodeDecl,
  EdgeDecl,
  OperationDecl,
  Endpoint,
  EdgeConstraints,
  JsonSchema,
} from '@astrale/typegraph-schema'
import {
  unwrapZod,
  getArrayElement,
  foldNullable,
  mapCardinality,
  hasRefTarget,
  cleanJsonSchema,
} from './helpers.js'

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
    const classes: Record<string, ClassDecl> = {}

    for (const [name, def] of Object.entries(this.schema.ifaces)) {
      classes[name] = this.serializeIface(name, def)
    }
    for (const [name, def] of Object.entries(this.schema.nodes)) {
      classes[name] = this.serializeNode(name, def)
    }
    for (const [name, def] of Object.entries(this.schema.edges)) {
      classes[name] = this.serializeEdge(name, def)
    }

    const result: SchemaIR = {
      version: '1.0',
      domain: this.schema.domain,
      types: this.types,
      classes,
    }
    if (Object.keys(this.imports).length > 0) {
      result.imports = this.imports
    }
    return result
  }

  private serializeIface(name: string, def: IfaceDef): NodeDecl {
    const config = def.config as Record<string, any>
    const result: NodeDecl = {
      type: 'node',
      name,
      abstract: true,
      implements: this.resolveIfaceParents(config),
      properties: this.serializeProperties(config.props, name),
      methods: this.serializeMethods(config.methods, name),
    }
    const data = this.serializeData(config.data)
    if (data) result.data = data
    return result
  }

  private serializeNode(name: string, def: NodeDef): NodeDecl {
    const config = def.config as Record<string, any>
    const result: NodeDecl = {
      type: 'node',
      name,
      abstract: false,
      implements: this.resolveNodeParents(config),
      properties: this.serializeProperties(config.props, name),
      methods: this.serializeMethods(config.methods, name),
    }
    const data = this.serializeData(config.data)
    if (data) result.data = data
    return result
  }

  private serializeEdge(name: string, def: EdgeDef): EdgeDecl {
    const config = def.config as Record<string, any>
    const from = def.from as EndpointCfg
    const to = def.to as EndpointCfg

    const result: EdgeDecl = {
      type: 'edge',
      name,
      endpoints: [this.serializeEndpoint(from), this.serializeEndpoint(to)],
      properties: this.serializeProperties(config.props, name),
      methods: this.serializeMethods(config.methods, name),
    }

    const constraints = this.serializeConstraints(config)
    if (constraints) result.constraints = constraints
    return result
  }

  private resolveIfaceParents(config: Record<string, any>): string[] {
    const exts = config.extends as IfaceDef[] | undefined
    if (!exts) return []
    return exts.map((e) => this.getDefName(e))
  }

  private resolveNodeParents(config: Record<string, any>): string[] {
    const result: string[] = []
    if (config.extends) {
      result.push(this.getDefName(config.extends))
    }
    if (config.implements) {
      for (const iface of config.implements as IfaceDef[]) {
        result.push(this.getDefName(iface))
      }
    }
    return result
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

  private serializeConstraints(config: Record<string, any>): EdgeConstraints | undefined {
    const c: EdgeConstraints = {}
    let has = false
    if (config.unique) { c.unique = true; has = true }
    if (config.noSelf) { c.noSelf = true; has = true }
    if (config.acyclic) { c.acyclic = true; has = true }
    if (config.symmetric) { c.symmetric = true; has = true }
    if (config.onDeleteSource) { c.onDeleteSource = config.onDeleteSource; has = true }
    if (config.onDeleteTarget) { c.onDeleteTarget = config.onDeleteTarget; has = true }
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

  private serializeProperty(
    _name: string,
    schema: z.ZodType,
    _className: string,
  ): JsonSchema {
    const { inner, nullable, defaultValue, hasDefault } = unwrapZod(schema)
    let jsonSchema = this.convertZodSchema(inner)
    if (nullable) jsonSchema = foldNullable(jsonSchema)
    if (hasDefault) jsonSchema = { ...jsonSchema, default: defaultValue }
    return jsonSchema
  }

  private serializeMethods(
    methods: Record<string, OpDef> | undefined,
    className: string,
  ): Record<string, OperationDecl> {
    if (!methods) return {}
    const result: Record<string, OperationDecl> = {}
    for (const [name, def] of Object.entries(methods)) {
      result[name] = this.serializeOp(name, def, className)
    }
    return result
  }

  private serializeOp(name: string, def: OpDef, _className?: string): OperationDecl {
    const config = def.config as Record<string, any>
    const returnSchema = config.returns as z.ZodType
    const { inner: returnInner, nullable: returnNullable } = unwrapZod(returnSchema)

    const op: OperationDecl = {
      name,
      access: config.access === 'private' ? 'private' : 'public',
      params: this.serializeParams(config.params, _className, name),
      returns: this.convertZodSchema(returnInner),
    }
    if (returnNullable) op.returnsNullable = true
    if (config.static) op.static = true
    return op
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
    if ((schema as any).__data_self) return { $dataRef: 'self' }
    if ((schema as any).__data_grant) return { $dataRef: this.getDefName((schema as any).__data_target) }

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
    const result: JsonSchema = { $nodeRef: this.getDefName((schema as any).__ref_target) }
    if ((schema as any).__ref_data) result.includeData = true
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
      `Serialization error: referenced def not found in schema and not registered in any schema.`,
    )
  }
}
