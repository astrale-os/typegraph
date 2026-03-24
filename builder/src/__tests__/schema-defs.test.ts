import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import type { SchemaRefs, SchemaClassRefs, SchemaOpRefs, SchemaRefsMap } from '../schema/refs.js'

import { interfaceDef, classDef, op } from '../defs/index.js'
import { defineSchema } from '../schema/define.js'
import { schemaRefs } from '../schema/refs.js'

// ── Type-level helpers ─────────────────────────────────────────────────────

/** Compile-time assertion: pass a type constraint, does nothing at runtime. */
function assert<_T extends true>() {}
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Includes<U, T> = T extends U ? true : false

// ── Test schema ────────────────────────────────────────────────────────────

const Publishable = interfaceDef({
  methods: {
    publish: op({ returns: z.boolean() }),
    unpublish: op({ returns: z.boolean() }),
  },
})

const Commentable = interfaceDef({
  extends: [Publishable],
  methods: {
    addComment: op({ params: { body: z.string() }, returns: z.string() }),
  },
})

const Author = classDef({
  props: { name: z.string() },
  methods: {
    updateProfile: op({ params: { name: z.string() }, returns: z.boolean() }),
    deactivate: op({ access: 'private', returns: z.void() }),
  },
})

const Article = classDef({
  inherits: [Commentable],
  props: { title: z.string() },
  methods: {
    archive: op({ returns: z.void() }),
  },
})

const FeaturedArticle = classDef({
  inherits: [Article],
  props: { priority: z.number() },
  methods: {
    promote: op({ returns: z.void() }),
  },
})

const Category = classDef({
  props: { name: z.string() },
  // no methods
})

const wrote = classDef({
  endpoints: [
    { as: 'author', types: [Author] },
    { as: 'article', types: [Article] },
  ],
  methods: {
    setPublishedAt: op({ params: { date: z.string() }, returns: z.boolean() }),
  },
})

const categorized_as = classDef({
  endpoints: [
    { as: 'article', types: [Article] },
    { as: 'category', types: [Category] },
  ],
  // no methods
})

const BlogSchema = defineSchema('blog.example.com', {
  Publishable,
  Commentable,
  Author,
  Article,
  FeaturedArticle,
  Category,
  wrote,
  categorized_as,
})

type Blog = typeof BlogSchema

// ── Type-level assertions ──────────────────────────────────────────────────

describe('SchemaRefs (type-level)', () => {
  describe('SchemaClassRefs', () => {
    type Classes = SchemaClassRefs<Blog>

    it('includes all top-level defs (interfaces, nodes, edges)', () => {
      // These all compile — they are valid class refs
      const allClasses: Classes[] = [
        'Publishable',
        'Commentable',
        'Author',
        'Article',
        'FeaturedArticle',
        'Category',
        'wrote',
        'categorized_as',
      ]
      expect(allClasses).toHaveLength(8)
    })

    it('rejects unknown names', () => {
      // @ts-expect-error — not a valid class ref
      const _bad: Classes = 'Nonexistent'
      void _bad
    })

    it('rejects qualified operation refs', () => {
      // @ts-expect-error — operations are not class refs
      const _bad: Classes = 'Author.deactivate'
      void _bad
    })
  })

  describe('SchemaOpRefs', () => {
    type Ops = SchemaOpRefs<Blog>

    it('includes own methods on concrete nodes', () => {
      const _: Ops = 'Author.updateProfile'
      const _2: Ops = 'Author.deactivate'
      const _3: Ops = 'Article.archive'
      const _4: Ops = 'FeaturedArticle.promote'
      void [_, _2, _3, _4]
    })

    it('includes inherited methods on concrete nodes', () => {
      // Article extends Commentable (extends Publishable)
      const _publish: Ops = 'Article.publish'
      const _unpublish: Ops = 'Article.unpublish'
      const _addComment: Ops = 'Article.addComment'

      // FeaturedArticle extends Article (which extends Commentable)
      const _fpublish: Ops = 'FeaturedArticle.publish'
      const _funpublish: Ops = 'FeaturedArticle.unpublish'
      const _faddComment: Ops = 'FeaturedArticle.addComment'
      const _farchive: Ops = 'FeaturedArticle.archive'

      void [_publish, _unpublish, _addComment, _fpublish, _funpublish, _faddComment, _farchive]
    })

    it('includes methods on edges', () => {
      const _: Ops = 'wrote.setPublishedAt'
      void _
    })

    it('excludes interface-qualified operations (MethodKeys skips ifaces)', () => {
      // @ts-expect-error — Publishable is an interface, not in MethodKeys
      const _bad: Ops = 'Publishable.publish'
      // @ts-expect-error — Commentable is an interface
      const _bad2: Ops = 'Commentable.addComment'
      void [_bad, _bad2]
    })

    it('excludes defs without methods', () => {
      // @ts-expect-error — Category has no methods
      const _bad: Ops = 'Category.anything'
      // @ts-expect-error — categorized_as has no methods
      const _bad2: Ops = 'categorized_as.anything'
      void [_bad, _bad2]
    })

    it('rejects nonexistent methods', () => {
      // @ts-expect-error — not a real method
      const _bad: Ops = 'Author.nonexistent'
      void _bad
    })

    it('rejects bare class names', () => {
      // @ts-expect-error — ops must be qualified
      const _bad: Ops = 'Author'
      void _bad
    })
  })

  describe('SchemaRefs (union of class + op refs)', () => {
    type Refs = SchemaRefs<Blog>

    it('includes both class refs and operation refs', () => {
      const _class: Refs = 'Author'
      const _iface: Refs = 'Publishable'
      const _edge: Refs = 'wrote'
      const _op: Refs = 'Author.deactivate'
      const _inheritedOp: Refs = 'Article.publish'
      const _edgeOp: Refs = 'wrote.setPublishedAt'
      void [_class, _iface, _edge, _op, _inheritedOp, _edgeOp]
    })

    it('rejects invalid refs', () => {
      // @ts-expect-error
      const _bad1: Refs = 'Nonexistent'
      // @ts-expect-error
      const _bad2: Refs = 'Author.nonexistent'
      // @ts-expect-error
      const _bad3: Refs = ''
      void [_bad1, _bad2, _bad3]
    })
  })

  // ── Target DX: total ID mapping ─────────────────────────────────────────

  describe('total ID mapping DX', () => {
    type Refs = SchemaRefs<Blog>
    type IdMapping = { [K in Refs]: string }

    it('enforces completeness — every def and operation must be mapped', () => {
      const ids: IdMapping = {
        // Top-level defs
        Publishable: 'iface:publishable',
        Commentable: 'iface:commentable',
        Author: 'node:author',
        Article: 'node:article',
        FeaturedArticle: 'node:featured-article',
        Category: 'node:category',
        wrote: 'edge:wrote',
        categorized_as: 'edge:categorized-as',
        // Author operations (own)
        'Author.updateProfile': 'op:author:update-profile',
        'Author.deactivate': 'op:author:deactivate',
        // Article operations (own + inherited)
        'Article.archive': 'op:article:archive',
        'Article.publish': 'op:article:publish',
        'Article.unpublish': 'op:article:unpublish',
        'Article.addComment': 'op:article:add-comment',
        // FeaturedArticle operations (own + inherited from Article + Commentable chain)
        'FeaturedArticle.promote': 'op:featured:promote',
        'FeaturedArticle.archive': 'op:featured:archive',
        'FeaturedArticle.publish': 'op:featured:publish',
        'FeaturedArticle.unpublish': 'op:featured:unpublish',
        'FeaturedArticle.addComment': 'op:featured:add-comment',
        // Edge operations
        'wrote.setPublishedAt': 'op:wrote:set-published-at',
      }

      // Runtime: verify all entries are strings
      for (const [key, value] of Object.entries(ids)) {
        expect(typeof key).toBe('string')
        expect(typeof value).toBe('string')
      }

      // Verify total count: 8 classes + ops
      expect(Object.keys(ids).length).toBeGreaterThan(8)
    })

    it('errors at compile time when a key is missing', () => {
      // @ts-expect-error — missing many required keys
      const _incomplete: IdMapping = {
        Author: 'node:author',
      }
      void _incomplete
    })
  })

  // ── Target DX: partial config ───────────────────────────────────────────

  describe('partial config DX', () => {
    type Classes = SchemaClassRefs<Blog>

    it('allows partial mappings with Partial<>', () => {
      const onConflict: Partial<{ [K in Classes]: 'merge' | 'skip' }> = {
        Author: 'merge',
        Article: 'skip',
        // others omitted — no error
      }

      expect(onConflict.Author).toBe('merge')
      expect(onConflict.Article).toBe('skip')
      expect(onConflict.Category).toBeUndefined()
    })
  })

  // ── Target DX: type narrowing ───────────────────────────────────────────

  describe('type narrowing DX', () => {
    it('SchemaClassRefs excludes operations', () => {
      assert<Equal<Includes<SchemaClassRefs<Blog>, 'Author.deactivate'>, false>>()
    })

    it('SchemaOpRefs excludes bare class names', () => {
      assert<Equal<Includes<SchemaOpRefs<Blog>, 'Author'>, false>>()
    })

    it('SchemaRefs is the union of class + op refs', () => {
      // Every class ref is in Defs
      assert<Includes<SchemaRefs<Blog>, SchemaClassRefs<Blog>>>()
      // Every op ref is in Defs
      assert<Includes<SchemaRefs<Blog>, SchemaOpRefs<Blog>>>()
    })
  })

  // ── Edge case: schema with no methods ───────────────────────────────────

  describe('schema with no methods', () => {
    const A = classDef({ props: { x: z.string() } })
    const B = classDef({})
    const a_b = classDef({
      endpoints: [
        { as: 'a', types: [A] },
        { as: 'b', types: [B] },
      ],
    })

    const NoMethodsSchema = defineSchema('no-methods.test', { A, B, a_b })
    type S = typeof NoMethodsSchema

    it('SchemaClassRefs still includes all defs', () => {
      type Classes = SchemaClassRefs<S>
      const _a: Classes = 'A'
      const _b: Classes = 'B'
      const _ab: Classes = 'a_b'
      void [_a, _b, _ab]
    })

    it('SchemaOpRefs is never when no defs have methods', () => {
      assert<Equal<SchemaOpRefs<S>, never>>()
    })

    it('SchemaRefs equals SchemaClassRefs when no methods', () => {
      assert<Equal<SchemaRefs<S>, SchemaClassRefs<S>>>()
    })
  })
})

// ── schemaRefs() runtime function ──────────────────────────────────────────

describe('schemaRefs()', () => {
  const refs = schemaRefs(BlogSchema)

  describe('top-level class refs', () => {
    it('nodes are plain strings', () => {
      expect(refs.Author).toBe('Author')
      expect(refs.Article).toBe('Article')
      expect(refs.FeaturedArticle).toBe('FeaturedArticle')
      expect(refs.Category).toBe('Category')
    })

    it('interfaces are plain strings', () => {
      expect(refs.Publishable).toBe('Publishable')
      expect(refs.Commentable).toBe('Commentable')
    })

    it('edges are plain strings', () => {
      expect(refs.wrote).toBe('wrote')
      expect(refs.categorized_as).toBe('categorized_as')
    })
  })

  describe('own operation refs', () => {
    it('Author has own operations', () => {
      expect(refs['Author.updateProfile']).toBe('Author.updateProfile')
      expect(refs['Author.deactivate']).toBe('Author.deactivate')
    })

    it('Article has own operations', () => {
      expect(refs['Article.archive']).toBe('Article.archive')
    })

    it('FeaturedArticle has own operations', () => {
      expect(refs['FeaturedArticle.promote']).toBe('FeaturedArticle.promote')
    })

    it('edge wrote has own operations', () => {
      expect(refs['wrote.setPublishedAt']).toBe('wrote.setPublishedAt')
    })
  })

  describe('inherited operation refs', () => {
    it('Article inherits from Commentable (extends Publishable)', () => {
      expect(refs['Article.publish']).toBe('Article.publish')
      expect(refs['Article.unpublish']).toBe('Article.unpublish')
      expect(refs['Article.addComment']).toBe('Article.addComment')
    })

    it('FeaturedArticle inherits full chain (Article + Commentable + Publishable)', () => {
      expect(refs['FeaturedArticle.archive']).toBe('FeaturedArticle.archive')
      expect(refs['FeaturedArticle.publish']).toBe('FeaturedArticle.publish')
      expect(refs['FeaturedArticle.unpublish']).toBe('FeaturedArticle.unpublish')
      expect(refs['FeaturedArticle.addComment']).toBe('FeaturedArticle.addComment')
    })
  })

  describe('defs without methods have no operation entries', () => {
    it('no Category.* keys exist', () => {
      const categoryOps = Object.keys(refs).filter((k) => k.startsWith('Category.'))
      expect(categoryOps).toEqual([])
    })

    it('no categorized_as.* keys exist', () => {
      const edgeOps = Object.keys(refs).filter((k) => k.startsWith('categorized_as.'))
      expect(edgeOps).toEqual([])
    })

    it('no Publishable.* or Commentable.* keys exist (interfaces skipped)', () => {
      const ifaceOps = Object.keys(refs).filter(
        (k) => k.startsWith('Publishable.') || k.startsWith('Commentable.'),
      )
      expect(ifaceOps).toEqual([])
    })
  })

  describe('completeness', () => {
    it('contains all expected keys', () => {
      const keys = Object.keys(refs).sort()
      expect(keys).toEqual([
        'Article',
        'Article.addComment',
        'Article.archive',
        'Article.publish',
        'Article.unpublish',
        'Author',
        'Author.deactivate',
        'Author.updateProfile',
        'Category',
        'Commentable',
        'FeaturedArticle',
        'FeaturedArticle.addComment',
        'FeaturedArticle.archive',
        'FeaturedArticle.promote',
        'FeaturedArticle.publish',
        'FeaturedArticle.unpublish',
        'Publishable',
        'categorized_as',
        'wrote',
        'wrote.setPublishedAt',
      ])
    })

    it('every value is an identity (key === value)', () => {
      for (const [key, value] of Object.entries(refs)) {
        expect(value).toBe(key)
      }
    })
  })

  describe('type safety', () => {
    it('refs type matches SchemaRefsMap', () => {
      const _typed: SchemaRefsMap<typeof BlogSchema> = refs
      void _typed
    })

    it('class ref is typed as its literal string', () => {
      const authorRef: 'Author' = refs.Author
      const wroteRef: 'wrote' = refs.wrote
      void [authorRef, wroteRef]
    })

    it('operation ref is typed as its qualified literal string', () => {
      const opRef: 'Author.deactivate' = refs['Author.deactivate']
      const edgeOpRef: 'wrote.setPublishedAt' = refs['wrote.setPublishedAt']
      void [opRef, edgeOpRef]
    })

    it('rejects nonexistent keys at compile time', () => {
      // @ts-expect-error — no such def in schema
      void refs.Nonexistent
      // @ts-expect-error — no such qualified operation
      void refs['Author.nonexistent']
    })
  })

  describe('usable as computed property keys', () => {
    it('class ref as computed key', () => {
      const obj = { [refs.Author]: 'value' } as Record<string, string>
      expect(obj.Author).toBe('value')
    })

    it('operation ref as computed key', () => {
      const obj = { [refs['Author.deactivate']]: 'value' } as Record<string, string>
      expect(obj['Author.deactivate']).toBe('value')
    })
  })

  describe('usable for indexing ID mappings', () => {
    it('refs index directly into a total ID map', () => {
      type IdMap = { [K in SchemaRefs<typeof BlogSchema>]: string }

      const ids: IdMap = {
        Author: 'id:author',
        Article: 'id:article',
        FeaturedArticle: 'id:featured',
        Category: 'id:category',
        Publishable: 'id:publishable',
        Commentable: 'id:commentable',
        wrote: 'id:wrote',
        categorized_as: 'id:categorized-as',
        'Author.updateProfile': 'id:author-update',
        'Author.deactivate': 'id:author-deactivate',
        'Article.archive': 'id:article-archive',
        'Article.publish': 'id:article-publish',
        'Article.unpublish': 'id:article-unpublish',
        'Article.addComment': 'id:article-add-comment',
        'FeaturedArticle.promote': 'id:featured-promote',
        'FeaturedArticle.archive': 'id:featured-archive',
        'FeaturedArticle.publish': 'id:featured-publish',
        'FeaturedArticle.unpublish': 'id:featured-unpublish',
        'FeaturedArticle.addComment': 'id:featured-add-comment',
        'wrote.setPublishedAt': 'id:wrote-set-published',
      }

      // Class refs index directly — plain strings
      expect(ids[refs.Author]).toBe('id:author')
      expect(ids[refs.wrote]).toBe('id:wrote')

      // Operation refs index directly — plain strings
      expect(ids[refs['Author.deactivate']]).toBe('id:author-deactivate')
      expect(ids[refs['Article.publish']]).toBe('id:article-publish')
      expect(ids[refs['wrote.setPublishedAt']]).toBe('id:wrote-set-published')
    })
  })
})
