import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { compileGsl } from '../src/compile-gsl.js'

/**
 * Integration tests for multi-file `extend` through the full codegen pipeline.
 *
 * These tests write real `.gsl` files to a temp directory so that
 * `LazyFileRegistry` can resolve local file imports end-to-end.
 */

let dir: string

beforeAll(() => {
  dir = join(tmpdir(), `gsl-multi-file-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('multi-file extend codegen', () => {
  it('generates TypeScript for types imported from a local .gsl file', () => {
    // shared.gsl: type alias + value type + interface + class
    writeFileSync(
      join(dir, 'shared.gsl'),
      `type Score = Int [>= 0]
type Currency = { code: String, symbol: String }
interface Timestamped { createdAt: DateTime }
class Product: Timestamped { name: String, price: Float }`,
    )

    const consumerPath = join(dir, 'consumer.gsl')
    writeFileSync(consumerPath, '')

    const { source, ir } = compileGsl(
      `extend "./shared.gsl" { Score, Currency, Timestamped, Product }
class Order: Timestamped {
  total: Float
}
class contains(order: Order, product: Product) [] {
  quantity: Int
}`,
      { compile: { sourceUri: consumerPath } },
    )

    // IR should contain imported definitions
    expect(ir.type_aliases.some((a) => a.name === 'Score')).toBe(true)
    expect(ir.value_types.some((v) => v.name === 'Currency')).toBe(true)
    expect(ir.classes.some((c) => c.name === 'Timestamped')).toBe(true)
    expect(ir.classes.some((c) => c.name === 'Product')).toBe(true)

    // Local declarations should also be present
    expect(ir.classes.some((c) => c.name === 'Order')).toBe(true)
    expect(ir.classes.some((c) => c.name === 'contains')).toBe(true)

    // Generated TS should include types from the extended file
    expect(source).toContain('Score')
    expect(source).toContain('Currency')
    expect(source).toContain('Order')
    expect(source).toContain('Product')
    expect(source).toContain('contains')
  })

  it('does not duplicate imported definitions that are already emitted locally', () => {
    // base.gsl: a type alias
    writeFileSync(join(dir, 'base-types.gsl'), `type PositiveInt = Int [>= 0]`)

    const mainPath = join(dir, 'consumer-dedup.gsl')
    writeFileSync(mainPath, '')

    const { ir } = compileGsl(
      `extend "./base-types.gsl" { PositiveInt }
class Widget { count: PositiveInt }`,
      { compile: { sourceUri: mainPath } },
    )

    // PositiveInt should appear exactly once in type_aliases
    const matches = ir.type_aliases.filter((a) => a.name === 'PositiveInt')
    expect(matches.length).toBe(1)
  })

  it('does not emit kernel symbols from remote extends', () => {
    const localPath = join(dir, 'kernel-consumer.gsl')
    writeFileSync(localPath, '')

    const { ir } = compileGsl(
      `extend "https://kernel.astrale.ai/v1" { Identity }
class User: Identity { name: String }`,
      { compile: { sourceUri: localPath } },
    )

    // Identity should NOT appear as a separate class in the IR
    // (it comes from the kernel, not a local file)
    const identityClasses = ir.classes.filter((c) => c.name === 'Identity')
    expect(identityClasses.length).toBe(0)

    // But User should be there
    expect(ir.classes.some((c) => c.name === 'User')).toBe(true)
  })

  it('handles chained local extends', () => {
    // types.gsl: shared types
    writeFileSync(join(dir, 'chain-types.gsl'), `type Email = String`)

    // models.gsl: extends types.gsl, declares an interface and class
    writeFileSync(
      join(dir, 'chain-models.gsl'),
      `extend "./chain-types.gsl" { Email }
interface Contactable { email: Email }
class Contact: Contactable { name: String }`,
    )

    // app.gsl: extends models.gsl
    const appPath = join(dir, 'chain-app.gsl')
    writeFileSync(appPath, '')

    const { source, ir } = compileGsl(
      `extend "./chain-models.gsl" { Contactable, Contact }
extend "./chain-types.gsl" { Email }
class Customer: Contactable { vip: Boolean }`,
      { compile: { sourceUri: appPath } },
    )

    expect(ir.classes.some((c) => c.name === 'Contact')).toBe(true)
    expect(ir.classes.some((c) => c.name === 'Contactable')).toBe(true)
    expect(ir.type_aliases.some((a) => a.name === 'Email')).toBe(true)
    expect(ir.classes.some((c) => c.name === 'Customer')).toBe(true)
    expect(source).toContain('Contact')
    expect(source).toContain('Customer')
  })
})
