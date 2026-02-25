import { z } from 'zod'
import type {
  Schema,
  IfaceDef,
  NodeDef,
  EdgeDef,
  OpDef,
  EndpointCfg,
  BitmaskDef,
  Cardinality as BuilderCardinality,
} from './types.js'
import { getDefRegistration } from './registry.js'
import type {
  SchemaIR,
  ClassDecl,
  NodeDecl,
  EdgeDecl,
  ComputedDefault,
  OperationDecl,
  Endpoint,
  Cardinality,
  EdgeConstraints,
  JsonSchema,
  JsonValue,
} from '@astrale/typegraph-schema'

// ── FnDefault sentinel ──────────────────────────────────────────────────────

const FN_SENTINEL = Symbol.for('astrale:fn-default')

interface FnDefaultValue {
  [FN_SENTINEL]: true
  name: string
  args: unknown[]
}

/**
 * Creates a computed default value sentinel for use in Zod `.default()`.
 *
 * @example
 * ```ts
 * const Timestamped = iface({
 *   props: { createdAt: z.string().datetime().default(fn('now')) }
 * })
 * ```
 */
export function fn(name: string, ...args: unknown[]): unknown {
  return { [FN_SENTINEL]: true, name, args }
}

function isFnDefault(value: unknown): value is FnDefaultValue {
  return typeof value === 'object' && value !== null && (value as any)[FN_SENTINEL] === true
}

// ── Serialize options ───────────────────────────────────────────────────────

export interface SerializeOptions {
  /**
   * Named types to hoist into the IR `types` record.
   * Pass Zod schemas that should be shared across multiple properties/params.
   * These are converted to JSON Schema and referenced via `$ref: '#/types/<name>'`.
   *
   * @example
   * ```ts
   * const Priority = z.enum(['low', 'medium', 'high', 'urgent'])
   * serialize(schema, { types: { Priority } })
   * ```
   */
  types?: Record<string, z.ZodType>
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Serializes a validated Schema into a SchemaIR.
 *
 * @param schema - A schema produced by `defineSchema()`
 * @param options - Optional: named types to hoist, etc.
 * @returns A JSON-serializable SchemaIR
 */
export function serialize(schema: Schema, options?: SerializeOptions): SchemaIR {
  const ctx = new SerializeContext(schema, options)
  return ctx.run()
}

// ── Zod introspection helpers ───────────────────────────────────────────────

function getZodDef(schema: z.ZodType): Record<string, any> | null {
  return (schema as any)?._zod?.def ?? (schema as any)?._def ?? null
}

function getZodTypeName(def: Record<string, any>): string | undefined {
  return def.typeName ?? def.type
}

function getZodInner(def: Record<string, any>): z.ZodType | null {
  return def.innerType ?? def.inner ?? null
}

interface UnwrapResult {
  inner: z.ZodType
  nullable: boolean
  defaultValue: unknown
  hasDefault: boolean
}

/**
 * Unwraps Zod optional/nullable/default wrappers to get the base schema.
 * Returns the inner schema, nullable flag, and default value (if any).
 */
function unwrapZod(schema: z.ZodType): UnwrapResult {
  let current = schema
  let nullable = false
  let defaultValue: unknown = undefined
  let hasDefault = false

  for (let i = 0; i < 10; i++) {
    const def = getZodDef(current)
    if (!def) break

    const typeName = getZodTypeName(def)

    if (typeName === 'ZodOptional' || typeName === 'optional') {
      nullable = true
      const inner = getZodInner(def)
      if (!inner) break
      current = inner
      continue
    }

    if (typeName === 'ZodNullable' || typeName === 'nullable') {
      nullable = true
      const inner = getZodInner(def)
      if (!inner) break
      current = inner
      continue
    }

    if (typeName === 'ZodDefault' || typeName === 'default') {
      hasDefault = true
      const dv = def.defaultValue !== undefined ? def.defaultValue : def.value
      defaultValue = typeof dv === 'function' ? dv() : dv
      const inner = getZodInner(def)
      if (!inner) break
      current = inner
      continue
    }

    break
  }

  return { inner: current, nullable, defaultValue, hasDefault }
}

/** Checks if a Zod schema is an array type and returns the element schema. */
function getArrayElement(schema: z.ZodType): z.ZodType | null {
  const def = getZodDef(schema)
  if (!def) return null
  const typeName = getZodTypeName(def)
  if (typeName === 'ZodArray' || typeName === 'array') {
    return def.element ?? def.items ?? null
  }
  return null
}

/**
 * Folds nullable into a JSON Schema by adding 'null' to the type array.
 * For schemas without a `type` field ($ref, $nodeRef, etc.), uses `anyOf`.
 */
function foldNullable(schema: JsonSchema): JsonSchema {
  if (schema.type) {
    const existing = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!existing.includes('null')) {
      return { ...schema, type: [...existing, 'null'] }
    }
    return schema
  }
  // For $ref, $nodeRef, etc. — use anyOf pattern
  return { anyOf: [schema, { type: 'null' }] }
}

/**
 * Converts an fn() sentinel default into a ComputedDefault.
 * Returns null if the value is not an fn sentinel.
 */
function toComputedDefault(value: FnDefaultValue): ComputedDefault {
  const result: ComputedDefault = { fn: value.name }
  if (value.args.length > 0) {
    result.args = value.args.map(toJsonValue)
  }
  return result
}

/** Converts an unknown value to a JSON-safe JsonValue. */
function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value === 'object') {
    const obj: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(value!)) obj[k] = toJsonValue(v)
    return obj
  }
  return null
}

// ── Implementation ──────────────────────────────────────────────────────────

class SerializeContext {
  /** Maps builder def objects to their schema key names. */
  private defToName = new Map<object, string>()

  /** Maps Zod instances (by identity) to hoisted type names. */
  private zodToTypeName = new WeakMap<z.ZodType, string>()

  /** The accumulated `types` record for the IR. */
  private types: Record<string, JsonSchema> = {}

  /** Computed defaults collected during serialization. */
  private defaults: Record<string, ComputedDefault> = {}

  /** Cross-domain imports collected during serialization: name → domain. */
  private imports: Record<string, string> = {}

  constructor(
    private schema: Schema,
    options?: SerializeOptions,
  ) {
    // Build def→name map from all schema entries
    for (const [name, def] of Object.entries(schema.defs)) {
      if (def && typeof def === 'object' && '__kind' in def) {
        this.defToName.set(def, name)
      }
    }

    // Register named types from options
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

    const operations: Record<string, OperationDecl> = {}
    for (const [name, def] of Object.entries(this.schema.operations)) {
      operations[name] = this.serializeOp(name, def)
    }

    const result: SchemaIR = {
      version: '1.0',
      domain: this.schema.domain,
      types: this.types,
      classes,
      operations,
    }
    if (Object.keys(this.imports).length > 0) {
      result.imports = this.imports
    }
    if (Object.keys(this.defaults).length > 0) {
      result.defaults = this.defaults
    }
    return result
  }

  // ── Class serializers ─────────────────────────────────────────────────

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

  // ── Inheritance resolution ────────────────────────────────────────────

  private resolveIfaceParents(config: Record<string, any>): string[] {
    const exts = config.extends as IfaceDef[] | undefined
    if (!exts) return []
    return exts.map((e) => this.getDefName(e))
  }

  private resolveNodeParents(config: Record<string, any>): string[] {
    const result: string[] = []
    // Single parent node (concrete inheritance)
    if (config.extends) {
      result.push(this.getDefName(config.extends))
    }
    // Interface implementation
    if (config.implements) {
      for (const iface of config.implements as IfaceDef[]) {
        result.push(this.getDefName(iface))
      }
    }
    return result
  }

  // ── Endpoint & constraints ────────────────────────────────────────────

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
    if (config.unique) {
      c.unique = true
      has = true
    }
    if (config.noSelf) {
      c.noSelf = true
      has = true
    }
    if (config.acyclic) {
      c.acyclic = true
      has = true
    }
    if (config.symmetric) {
      c.symmetric = true
      has = true
    }
    if (config.onDeleteSource) {
      c.onDeleteSource = config.onDeleteSource
      has = true
    }
    if (config.onDeleteTarget) {
      c.onDeleteTarget = config.onDeleteTarget
      has = true
    }
    return has ? c : undefined
  }

  // ── Properties ─────────────────────────────────────────────────────────

  private serializeProperties(
    props: Record<string, z.ZodType | BitmaskDef> | undefined,
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
    name: string,
    schema: z.ZodType | BitmaskDef,
    className: string,
  ): JsonSchema {
    // Bitmask → special integer type
    if (isBitmask(schema)) {
      return { type: 'integer', 'x-bitmask': true }
    }

    const zodSchema = schema as z.ZodType

    // Unwrap optional/nullable/default layers
    const { inner, nullable, defaultValue, hasDefault } = unwrapZod(zodSchema)

    // Convert the inner schema to JSON Schema
    let jsonSchema = this.convertZodSchema(inner)

    // Fold nullable into the schema
    if (nullable) {
      jsonSchema = foldNullable(jsonSchema)
    }

    // Handle defaults
    if (hasDefault) {
      if (isFnDefault(defaultValue)) {
        // Computed default → store separately
        this.defaults[`${className}.${name}`] = toComputedDefault(defaultValue)
      } else {
        // Primitive default → fold into schema
        jsonSchema = { ...jsonSchema, default: defaultValue }
      }
    }

    return jsonSchema
  }

  // ── Methods / Operations ──────────────────────────────────────────────

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

  private serializeOp(name: string, def: OpDef, className?: string): OperationDecl {
    const config = def.config as Record<string, any>

    // Unwrap return type in case it's wrapped in optional/default
    const returnSchema = config.returns as z.ZodType
    const { inner: returnInner, nullable: returnNullable } = unwrapZod(returnSchema)

    const op: OperationDecl = {
      name,
      access: config.access === 'private' ? 'private' : 'public',
      params: this.serializeParams(config.params, className, name),
      returns: this.convertZodSchema(returnInner),
    }
    if (returnNullable) op.returnsNullable = true
    return op
  }

  private serializeParams(
    params: Record<string, z.ZodType> | (() => Record<string, z.ZodType>) | undefined,
    className: string | undefined,
    methodName: string,
  ): Record<string, JsonSchema> {
    if (!params) return {}
    // Thunks should already be resolved by defineSchema()
    const resolved = typeof params === 'function' ? params() : params
    const result: Record<string, JsonSchema> = {}

    for (const [name, schema] of Object.entries(resolved)) {
      const zodSchema = schema as z.ZodType

      // Check for $nodeRef before unwrapping (ref() is a z.custom wrapper)
      if (hasRefTarget(zodSchema)) {
        result[name] = this.buildNodeRef(zodSchema)
        continue
      }

      // Unwrap optional/nullable/default
      const { inner, nullable, defaultValue, hasDefault } = unwrapZod(zodSchema)

      // Check the inner schema for $nodeRef too (in case of ref().optional())
      if (hasRefTarget(inner)) {
        let refSchema: JsonSchema = this.buildNodeRef(inner)
        if (nullable) refSchema = foldNullable(refSchema)
        if (hasDefault) {
          if (isFnDefault(defaultValue)) {
            const key = className ? `${className}.${methodName}.${name}` : `${methodName}.${name}`
            this.defaults[key] = toComputedDefault(defaultValue)
          } else {
            refSchema = { ...refSchema, default: defaultValue }
          }
        }
        result[name] = refSchema
        continue
      }

      let jsonSchema = this.convertZodSchema(inner)
      if (nullable) jsonSchema = foldNullable(jsonSchema)
      if (hasDefault) {
        if (isFnDefault(defaultValue)) {
          const key = className ? `${className}.${methodName}.${name}` : `${methodName}.${name}`
          this.defaults[key] = toComputedDefault(defaultValue)
        } else {
          jsonSchema = { ...jsonSchema, default: defaultValue }
        }
      }
      result[name] = jsonSchema
    }
    return result
  }

  // ── Zod → JSON Schema conversion ─────────────────────────────────────

  /**
   * Converts a Zod schema to JSON Schema, handling special builder types.
   * This is the core conversion function called for all schema slots.
   */
  private convertZodSchema(schema: z.ZodType): JsonSchema {
    // $nodeRef
    if (hasRefTarget(schema)) {
      return this.buildNodeRef(schema)
    }

    // $dataRef (self)
    if ((schema as any).__data_self) {
      return { $dataRef: 'self' }
    }

    // $dataRef (target)
    if ((schema as any).__data_grant) {
      return { $dataRef: this.getDefName((schema as any).__data_target) }
    }

    // Named type → $ref
    const typeName = this.zodToTypeName.get(schema)
    if (typeName) {
      return { $ref: `#/types/${typeName}` }
    }

    // Array with special inner type (e.g., z.array(ref(Order)))
    const element = getArrayElement(schema)
    if (element) {
      const itemSchema = this.convertZodSchema(element)
      // If the inner schema is just a standard JSON Schema array,
      // let z.toJSONSchema handle it. Only intercept if inner is special.
      if (itemSchema.$nodeRef || itemSchema.$dataRef || itemSchema.$ref) {
        return { type: 'array', items: itemSchema }
      }
    }

    // Standard: delegate to z.toJSONSchema()
    return this.zodToJsonSchemaRaw(schema)
  }

  /** Converts a Zod schema to JSON Schema via Zod's built-in converter. */
  private zodToJsonSchemaRaw(schema: z.ZodType): JsonSchema {
    try {
      const result = z.toJSONSchema(schema) as Record<string, unknown>
      return cleanJsonSchema(result)
    } catch {
      // Fallback for schemas that can't be converted (e.g., z.custom)
      return {}
    }
  }

  // ── Data schema ───────────────────────────────────────────────────────

  private serializeData(data: Record<string, z.ZodType> | undefined): JsonSchema | undefined {
    if (!data || Object.keys(data).length === 0) return undefined
    const objectSchema = z.object(data as Record<string, z.ZodType>)
    const result = z.toJSONSchema(objectSchema) as Record<string, unknown>
    return cleanJsonSchema(result)
  }

  // ── Ref helpers ─────────────────────────────────────────────────────

  private buildNodeRef(schema: z.ZodType): JsonSchema {
    const result: JsonSchema = { $nodeRef: this.getDefName((schema as any).__ref_target) }
    if ((schema as any).__ref_data) result.includeData = true
    return result
  }

  // ── Lookup ────────────────────────────────────────────────────────────

  private getDefName(def: object): string {
    // Local def — in this schema
    const local = this.defToName.get(def)
    if (local) return local

    // External def — registered by another defineSchema call
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

// ── Pure utility functions ──────────────────────────────────────────────────

function mapCardinality(c: BuilderCardinality): Cardinality | undefined {
  switch (c) {
    case '0..1':
      return { min: 0, max: 1 }
    case '1':
      return { min: 1, max: 1 }
    case '0..*':
      return undefined // Default unbounded — omitted per spec §3.8
    case '1..*':
      return { min: 1, max: null }
  }
}

function isBitmask(schema: unknown): schema is BitmaskDef {
  return typeof schema === 'object' && schema !== null && (schema as any).__kind === 'bitmask'
}

function hasRefTarget(schema: z.ZodType): boolean {
  return schema != null && typeof schema === 'object' && '__ref_target' in schema
}

function cleanJsonSchema(schema: Record<string, unknown>): JsonSchema {
  const result: JsonSchema = {}
  for (const [key, value] of Object.entries(schema)) {
    // Strip JSON Schema meta-fields that z.toJSONSchema adds
    if (key === '$schema') continue
    result[key] = value
  }
  return result
}
