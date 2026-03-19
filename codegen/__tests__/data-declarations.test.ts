// __tests__/data-declarations.test.ts
// ============================================================
// Codegen tests for data declarations and brace projections.
// ============================================================

import { describe, it, expect } from 'vitest'
import { compileAndGenerate, compileToModel } from './helpers.js'

// ─── Data Type Interface Emission ────────────────────────────

describe('Data Type Interfaces', () => {
  it('emits interface for structured data type', () => {
    const { source } = compileAndGenerate(`
      data OperationData = {
        paramsSchema: String
        resultSchema: String
        code: String
      }
      class Operation {
        name: String
        data OperationData
      }
    `)
    expect(source).toContain('export interface OperationData {')
    expect(source).toContain('paramsSchema: string')
    expect(source).toContain('resultSchema: string')
    expect(source).toContain('code: string')
  })

  it('emits type alias for scalar data type', () => {
    const { source } = compileAndGenerate(`
      data Payload = String
      class Module {
        title: String
        data Payload
      }
    `)
    expect(source).toContain('export type Payload = string')
  })

  it('emits WithData utility type when data types exist', () => {
    const { source } = compileAndGenerate(`
      data Blob = String
      class Mod {
        name: String
        data Blob
      }
    `)
    expect(source).toContain('export type WithData<T, D> = T & { data(): Promise<D> }')
  })

  it('does NOT emit WithData when no data types exist', () => {
    const { source } = compileAndGenerate(`
      class User {
        email: String
      }
    `)
    expect(source).not.toContain('WithData')
  })

  it('emits data type with nullable fields', () => {
    const { source } = compileAndGenerate(`
      data Meta = {
        description: String?
      }
      class Item {
        name: String
        data Meta
      }
    `)
    expect(source).toContain('description?: string | null')
  })

  it('emits data type with list fields', () => {
    const { source } = compileAndGenerate(`
      data Tags = {
        items: String[]
      }
      class Doc {
        title: String
        data Tags
      }
    `)
    expect(source).toContain('items: string[]')
  })

  it('emits inline data type declared inside class body', () => {
    const { source } = compileAndGenerate(`
      class Operation {
        name: String
        data OperationData = {
          code: String
          schema: String
        }
      }
    `)
    expect(source).toContain('export interface OperationData {')
    expect(source).toContain('code: string')
    expect(source).toContain('schema: string')
  })
})

// ─── Method Return Types with Projections ────────────────────

describe('Method Return Types — Projections', () => {
  const OPERATION_SCHEMA = `
    data OperationData = {
      paramsSchema: String
      resultSchema: String
      code: String
    }

    class Operation {
      name: String
      syscall: Boolean
      description: String

      data OperationData

      fn getOp(): Operation
      fn getOpFull(): Operation { *, OperationData }
      fn listOps(): Operation { name, syscall }[]
      fn getOpMeta(): Operation { name, description, OperationData }
      fn getOpCode(): Operation { OperationData }
      fn listAll(): Operation { * }[]
    }
  `

  it('bare return type + data → WithData<Type, DataType>', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(/getOp\(\):\s*WithData<Operation, OperationData>/)
  })

  it('{ *, DataType } → WithData<Type, DataType>', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(/getOpFull\(\):\s*WithData<Operation, OperationData>/)
  })

  it('{ field1, field2 } → Pick<Type, fields>', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(/listOps\(\):\s*Pick<Operation, 'name' \| 'syscall'>\[\]/)
  })

  it('{ field, DataType } → WithData<Pick<Type, field>, DataType>', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(
      /getOpMeta\(\):\s*WithData<Pick<Operation, 'name' \| 'description'>, OperationData>/,
    )
  })

  it('{ DataType } only → data accessor object', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(/getOpCode\(\):\s*\{ data\(\): Promise<OperationData> \}/)
  })

  it('{ * } → just the type, no WithData', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(/listAll\(\):\s*Operation\[\]/)
  })

  it('list suffix is applied after projection', () => {
    const { source } = compileAndGenerate(OPERATION_SCHEMA)
    expect(source).toMatch(/listOps\(\):\s*Pick<Operation, 'name' \| 'syscall'>\[\]/)
  })
})

// ─── Classes Without Data ────────────────────────────────────

describe('Classes Without Data', () => {
  it('bare return type without data → plain type, no WithData', () => {
    const { source } = compileAndGenerate(`
      class Customer {
        email: String
        name: String
        fn get(): Customer
      }
    `)
    expect(source).toMatch(/get\(\):\s*Customer \| Promise<Customer>/)
    expect(source).not.toContain('WithData<Customer')
  })

  it('projection on class without data → Pick only', () => {
    const { source } = compileAndGenerate(`
      class Customer {
        email: String
        name: String
        fn list(): Customer { name }[]
      }
    `)
    expect(source).toContain("Pick<Customer, 'name'>[]")
    expect(source).not.toContain('WithData')
  })

  it('{ * } on class without data → same as bare', () => {
    const { source } = compileAndGenerate(`
      class Customer {
        email: String
        name: String
        fn getAll(): Customer { * }
      }
    `)
    expect(source).toMatch(/getAll\(\):\s*Customer \| Promise<Customer>/)
  })
})

// ─── TypeMap nodeData Section ────────────────────────────────

describe('TypeMap — nodeData', () => {
  it('includes nodeData for classes with data', () => {
    const { source } = compileAndGenerate(`
      data OpData = { code: String }
      class Operation {
        name: String
        data OpData
      }
    `)
    expect(source).toContain('nodeData: {')
    expect(source).toContain('Operation: OpData')
  })

  it('omits nodeData section when no classes have data', () => {
    const { source } = compileAndGenerate(`
      class User {
        email: String
      }
    `)
    expect(source).not.toContain('nodeData')
  })
})

// ─── GraphModel (Loader) Tests ───────────────────────────────

describe('GraphModel — Data Types', () => {
  it('populates dataTypes map from IR', () => {
    const model = compileToModel(`
      data Payload = String
      class Mod {
        name: String
        data Payload
      }
    `)
    expect(model.dataTypes.size).toBe(1)
    expect(model.dataTypes.has('Payload')).toBe(true)
    const dt = model.dataTypes.get('Payload')!
    expect(dt.scalarType).toBe('String')
    expect(dt.fields).toBeNull()
  })

  it('populates structured dataType fields', () => {
    const model = compileToModel(`
      data OpData = {
        code: String
        size: Int
      }
      class Op {
        name: String
        data OpData
      }
    `)
    const dt = model.dataTypes.get('OpData')!
    expect(dt.fields).not.toBeNull()
    expect(dt.fields).toHaveLength(2)
    expect(dt.fields![0].name).toBe('code')
    expect(dt.fields![1].name).toBe('size')
  })

  it('sets dataRef on ResolvedNode', () => {
    const model = compileToModel(`
      data OpData = { code: String }
      class Operation {
        name: String
        data OpData
      }
    `)
    const node = model.nodeDefs.get('Operation')!
    expect(node.dataRef).toBe('OpData')
  })

  it('leaves dataRef undefined for nodes without data', () => {
    const model = compileToModel(`
      class User {
        email: String
      }
    `)
    const node = model.nodeDefs.get('User')!
    expect(node.dataRef).toBeUndefined()
  })
})

// ─── Edge Cases & Adversarial ────────────────────────────────

describe('Edge Cases', () => {
  it('two classes each with their own data type', () => {
    const { source } = compileAndGenerate(`
      data AlphaData = { x: Int }
      data BetaData = { y: String }

      class Alpha {
        name: String
        data AlphaData
        fn get(): Alpha
      }

      class Beta {
        label: String
        data BetaData
        fn get(): Beta
      }
    `)
    expect(source).toContain('export interface AlphaData {')
    expect(source).toContain('export interface BetaData {')
    expect(source).toContain('WithData<Alpha, AlphaData>')
    expect(source).toContain('WithData<Beta, BetaData>')
  })

  it('data field names can overlap with class attribute names', () => {
    const { source } = compileAndGenerate(`
      data ItemData = {
        name: String
        price: Float
      }
      class Item {
        name: String
        price: Float
        data ItemData
        fn get(): Item
      }
    `)
    expect(source).toContain('export interface ItemData {')
    expect(source).toContain('export interface Item {')
    expect(source).toContain('WithData<Item, ItemData>')
  })

  it('class with data: attribute AND data declaration', () => {
    const { source } = compileAndGenerate(`
      data Meta = { info: String }
      class Doc {
        data: String
        title: String
        data Meta
        fn get(): Doc
      }
    `)
    // data: should be a regular field
    expect(source).toContain('data: string')
    // Meta should be a data type interface
    expect(source).toContain('export interface Meta {')
    // Return type should include WithData
    expect(source).toContain('WithData<Doc, Meta>')
  })

  it('multiple methods with different projections on same class', () => {
    const { source } = compileAndGenerate(`
      data NodeData = { blob: String }
      class Thing {
        alpha: String
        beta: Int
        gamma: Boolean
        data NodeData

        fn getAll(): Thing
        fn pickTwo(): Thing { alpha, beta }
        fn withData(): Thing { alpha, NodeData }
        fn dataOnly(): Thing { NodeData }
        fn noData(): Thing { * }
      }
    `)
    expect(source).toContain('WithData<Thing, NodeData>')
    expect(source).toContain("Pick<Thing, 'alpha' | 'beta'>")
    expect(source).toContain("WithData<Pick<Thing, 'alpha'>, NodeData>")
    expect(source).toContain('{ data(): Promise<NodeData> }')
    // noData → plain Thing
    expect(source).toMatch(/noData\(\):\s*Thing \| Promise<Thing>/)
  })

  it('class with no attributes but with data', () => {
    const { source } = compileAndGenerate(`
      data Blob = String
      class Raw {
        data Blob
        fn get(): Raw
      }
    `)
    expect(source).toContain('WithData<Raw, Blob>')
  })

  it('data type used by multiple classes', () => {
    const { source } = compileAndGenerate(`
      data SharedBlob = { content: String }

      class FileA {
        name: String
        data SharedBlob
        fn get(): FileA
      }

      class FileB {
        path: String
        data SharedBlob
        fn get(): FileB
      }
    `)
    expect(source).toContain('WithData<FileA, SharedBlob>')
    expect(source).toContain('WithData<FileB, SharedBlob>')
    // SharedBlob interface emitted once
    const matches = source.match(/export interface SharedBlob \{/g)
    expect(matches).toHaveLength(1)
  })

  it('projection with star on class with many attributes', () => {
    const { source } = compileAndGenerate(`
      data BigData = { payload: String }
      class BigClass {
        a: String
        b: String
        c: String
        d: String
        e: String
        data BigData
        fn getAll(): BigClass { * }
        fn getAllWithData(): BigClass { *, BigData }
      }
    `)
    // { * } → BigClass (no data)
    expect(source).toMatch(/getAll\(\):\s*BigClass \| Promise<BigClass>/)
    // { *, BigData } → WithData<BigClass, BigData>
    expect(source).toContain('WithData<BigClass, BigData>')
  })

  it('method returning non-node type ignores projection gracefully', () => {
    const { source } = compileAndGenerate(`
      class Obj {
        name: String
        fn count(): Int
      }
    `)
    // Should just be Int (number) without any projection logic
    expect(source).toMatch(/count\(\):\s*number \| Promise<number>/)
    expect(source).not.toContain('Pick<')
    expect(source).not.toContain('WithData<')
  })

  it('empty data body generates empty interface', () => {
    const { source } = compileAndGenerate(`
      data EmptyData = {}
      class Holder {
        name: String
        data EmptyData
      }
    `)
    expect(source).toContain('export interface EmptyData {}')
  })

  it('inline data declaration (not standalone) generates interface', () => {
    const { source } = compileAndGenerate(`
      class Server {
        host: String
        data ServerConfig = {
          port: Int
          maxConn: Int
        }
        fn get(): Server
      }
    `)
    expect(source).toContain('export interface ServerConfig {')
    expect(source).toContain('port: number')
    expect(source).toContain('maxConn: number')
    expect(source).toContain('WithData<Server, ServerConfig>')
  })

  it('star + fields + data → WithData<Type, DataType> (star absorbs fields)', () => {
    const { source } = compileAndGenerate(`
      data ThingData = { blob: String }
      class Thing {
        alpha: String
        beta: Int
        data ThingData
        fn getMixed(): Thing { *, alpha, ThingData }
      }
    `)
    expect(source).toMatch(/getMixed\(\):\s*WithData<Thing, ThingData>/)
  })

  it('star + fields (no data) → plain type (star absorbs fields)', () => {
    const { source } = compileAndGenerate(`
      class Widget {
        x: String
        y: Int
        fn getAll(): Widget { *, x }
      }
    `)
    expect(source).toMatch(/getAll\(\):\s*Widget \| Promise<Widget>/)
  })

  it('array of data-only projection', () => {
    const { source } = compileAndGenerate(`
      data BlobData = { content: String }
      class File {
        name: String
        data BlobData
        fn listBlobs(): File { BlobData }[]
      }
    `)
    expect(source).toMatch(/listBlobs\(\):\s*\{ data\(\): Promise<BlobData> \}\[\]/)
  })

  it('array of fields + data projection', () => {
    const { source } = compileAndGenerate(`
      data Meta = { info: String }
      class Doc {
        title: String
        author: String
        data Meta
        fn listDocs(): Doc { title, Meta }[]
      }
    `)
    expect(source).toMatch(/listDocs\(\):\s*WithData<Pick<Doc, 'title'>, Meta>\[\]/)
  })

  it('array of star + data projection', () => {
    const { source } = compileAndGenerate(`
      data Blob = { raw: String }
      class Asset {
        name: String
        data Blob
        fn listAssets(): Asset { *, Blob }[]
      }
    `)
    expect(source).toMatch(/listAssets\(\):\s*WithData<Asset, Blob>\[\]/)
  })

  it('bare array return with data class', () => {
    const { source } = compileAndGenerate(`
      data ItemData = { payload: String }
      class Item {
        label: String
        data ItemData
        fn listAll(): Item[]
      }
    `)
    expect(source).toMatch(/listAll\(\):\s*WithData<Item, ItemData>\[\]/)
  })

  it('single field projection', () => {
    const { source } = compileAndGenerate(`
      class User {
        name: String
        email: String
        fn getName(): User { name }
      }
    `)
    expect(source).toContain("Pick<User, 'name'>")
  })

  it('projection does not affect other methods on same class', () => {
    const { source } = compileAndGenerate(`
      class Account {
        balance: Float
        owner: String
        fn getBalance(): Account { balance }
        fn getFull(): Account
      }
    `)
    // getBalance → Pick, getFull → plain Account
    expect(source).toContain("Pick<Account, 'balance'>")
    expect(source).toMatch(/getFull\(\):\s*Account \| Promise<Account>/)
  })
})
