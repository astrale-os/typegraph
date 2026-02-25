import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { generate } from './generate'
import { normalizeIR, load } from './loader'
import type { SchemaIR } from './model'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BLOG_IR_PATH = resolve(__dirname, '../../compiler/blog-compiled.json')

function loadBlogIR(): SchemaIR {
  const raw = JSON.parse(readFileSync(BLOG_IR_PATH, 'utf-8'))
  return normalizeIR(raw)
}

// ─── Loader Tests ───────────────────────────────────────────

describe('load', () => {
  it('builds a GraphModel from a single SchemaIR', () => {
    const ir = loadBlogIR()
    const model = load([ir])

    expect(model.scalars).toContain('String')
    expect(model.scalars).toContain('Timestamp')
    expect(model.aliases.has('Email')).toBe(true)
    expect(model.aliases.get('Email')!.constraints?.format).toBe('email')
    expect(model.nodeDefs.has('User')).toBe(true)
    expect(model.nodeDefs.has('Post')).toBe(true)
    expect(model.edgeDefs.has('follows')).toBe(true)
  })

  it('resolves inheritance — User gets Timestamped attributes', () => {
    const ir = loadBlogIR()
    const model = load([ir])
    const user = model.nodeDefs.get('User')!
    const attrNames = user.allAttributes.map((a) => a.name)

    expect(attrNames).toContain('created_at')
    expect(attrNames).toContain('updated_at')
    expect(attrNames).toContain('username')
    expect(attrNames).toContain('email')
  })

  it('resolves multi-level inheritance — Post gets Publishable + Timestamped + Reactable', () => {
    const ir = loadBlogIR()
    const model = load([ir])
    const post = model.nodeDefs.get('Post')!
    const attrNames = post.allAttributes.map((a) => a.name)

    expect(attrNames).toContain('created_at') // from Timestamped
    expect(attrNames).toContain('published_at') // from Publishable
    expect(attrNames).toContain('reaction_count') // from Reactable
    expect(attrNames).toContain('title') // own
    expect(attrNames).toContain('slug') // own
  })

  it('creates stubs for imported types', () => {
    const ir = loadBlogIR()
    const model = load([ir])

    // Identity is imported from kernel extension
    const identity = model.nodeDefs.get('Identity')
    expect(identity).toBeDefined()
    expect(identity!.abstract).toBe(true)
  })

  it('identifies enum aliases', () => {
    const ir = loadBlogIR()
    const model = load([ir])
    const plan = model.aliases.get('Plan')!

    expect(plan.isEnum).toBe(true)
    expect(plan.enumValues).toEqual(['free', 'pro', 'enterprise'])
  })

  it('deduplicates identical definitions across multiple inputs', () => {
    const ir = loadBlogIR()
    // Loading the same IR twice should not throw
    const model = load([ir, ir])
    expect(model.nodeDefs.has('User')).toBe(true)
  })
})

// ─── Generate Tests ─────────────────────────────────────────

describe('generate', () => {
  it('produces valid TypeScript source', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('@generated')
    expect(source).toContain("import { z } from 'zod'")
  })

  it('emits enum const tuples and types', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain("export const PlanValues = ['free', 'pro', 'enterprise'] as const")
    expect(source).toContain('export type Plan = (typeof PlanValues)[number]')
  })

  it('emits non-enum type aliases', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export type Email = string')
    expect(source).toContain('export type Slug = string')
  })

  it('emits node interfaces with extends clauses', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export interface Timestamped {')
    expect(source).toContain('export interface Publishable extends Timestamped {')
    expect(source).toContain('export interface User extends Identity, Timestamped {')
    expect(source).toContain('export interface Post extends Publishable, Reactable {')
  })

  it('emits edge payload interfaces', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export interface MemberOfPayload {')
    expect(source).toContain('export interface FlaggedPayload {')
  })

  it('emits validators with Zod schemas', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export const validators = {')
    expect(source).toContain('Email: z.string().email(),')
    expect(source).toContain('Plan: z.enum(PlanValues),')
    expect(source).toContain('User: z.object({')
  })

  it('emits runtime schema value', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export const schema = {')
    expect(source).toContain("scalars: ['String',")
    expect(source).toContain('nodes: {')
    expect(source).toContain('edges: {')
  })

  it('emits SchemaNodeType union (concrete nodes only)', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain(
      "export type SchemaNodeType = 'User' | 'Organization' | 'Post' | 'Comment' | 'Tag'",
    )
    // Abstract nodes should NOT appear in SchemaNodeType
    expect(source).not.toMatch(/SchemaNodeType\s*=.*'Timestamped'/)
    expect(source).not.toMatch(/SchemaNodeType\s*=.*'Publishable'/)
    expect(source).not.toMatch(/SchemaNodeType\s*=.*'Reactable'/)
  })

  it('emits SchemaEdgeType union', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export type SchemaEdgeType =')
    expect(source).toMatch(/'follows'/)
    expect(source).toMatch(/'authored'/)
    expect(source).toMatch(/'member_of'/)
  })

  it('emits SchemaType as union of node + edge types', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export type SchemaType = SchemaNodeType | SchemaEdgeType')
  })

  it('emits CoreNodeProps referencing generated interfaces', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export interface CoreNodeProps {')
    expect(source).toContain('User: Partial<User>')
    expect(source).toContain('Post: Partial<Post>')
    expect(source).toContain('Tag: Partial<Tag>')
  })

  it('emits CoreEdgeEndpoints with correct param names', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export interface CoreEdgeEndpoints {')
    expect(source).toContain('follows: { follower: string; followee: string }')
    expect(source).toContain('authored: { author: string; content: string }')
    expect(source).toContain('member_of: { user: string; org: string }')
    expect(source).toContain('flagged: { about: string }')
  })

  it('emits CoreEdgeProps only for edges with attributes', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export interface CoreEdgeProps {')
    expect(source).toContain('member_of: Partial<MemberOfPayload>')
    expect(source).toContain('flagged: Partial<FlaggedPayload>')
    // follows has no attributes — should not appear
    expect(source).not.toMatch(/CoreEdgeProps[\s\S]*follows/)
  })

  it('emits node() with overloads for children type preservation', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    // First overload: without children
    expect(source).toContain('export function node<T extends SchemaNodeType>(')
    // Second overload: with children (preserves literal keys)
    expect(source).toContain(
      'export function node<T extends SchemaNodeType, C extends Record<string, CoreNodeDef>>(',
    )
  })

  it('emits edge() with conditional props', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('export function edge<T extends SchemaEdgeType>(')
    expect(source).toContain('props?: T extends keyof CoreEdgeProps ? CoreEdgeProps[T] : never,')
  })

  it('emits defineCore() with const type parameter', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain(
      'export function defineCore<const T extends CoreDefinition>(def: T): T {',
    )
  })

  it('emits Refs type with recursive key extraction', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])

    expect(source).toContain('type FlattenCoreKeys<T extends Record<string, any>>')
    expect(source).toContain('export type ExtractCoreKeys<T extends CoreDefinition>')
    expect(source).toContain('export type Refs<T extends CoreDefinition = CoreDefinition>')
    expect(source).toContain('Record<SchemaType | Extract<ExtractCoreKeys<T>, string>, NodeId>')
  })

  it('snapshot — full generated output', () => {
    const ir = loadBlogIR()
    const { source } = generate([ir])
    expect(source).toMatchSnapshot()
  })
})
