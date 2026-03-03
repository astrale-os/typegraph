import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { iface, rawNodeDef as nodeDef, edgeDef, op } from '../builders.js'
import { defineSchema } from '../schema.js'
import type { SchemaDefs, SchemaClassDefs, SchemaOpDefs, SchemaDefsMap } from '../types.js'
import { schemaDefs } from '../defs.js'

// ── Type-level helpers ─────────────────────────────────────────────────────

/** Compile-time assertion: pass a type constraint, does nothing at runtime. */
function assert<_T extends true>() {}
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Includes<U, T> = T extends U ? true : false

// ── Test schema ────────────────────────────────────────────────────────────

const Publishable = iface({
  methods: {
    publish: op({ returns: z.boolean() }),
    unpublish: op({ returns: z.boolean() }),
  },
})

const Commentable = iface({
  extends: [Publishable],
  methods: {
    addComment: op({ params: { body: z.string() }, returns: z.string() }),
  },
})

const Author = nodeDef({
  props: { name: z.string() },
  methods: {
    updateProfile: op({ params: { name: z.string() }, returns: z.boolean() }),
    deactivate: op({ access: 'private', returns: z.void() }),
  },
})

const Article = nodeDef({
  implements: [Commentable],
  props: { title: z.string() },
  methods: {
    archive: op({ returns: z.void() }),
  },
})

const FeaturedArticle = nodeDef({
  extends: Article,
  implements: [],
  props: { priority: z.number() },
  methods: {
    promote: op({ returns: z.void() }),
  },
})

const Category = nodeDef({
  props: { name: z.string() },
  // no methods
})

const wrote = edgeDef(
  { as: 'author', types: [Author] },
  { as: 'article', types: [Article] },
  {
    methods: {
      setPublishedAt: op({ params: { date: z.string() }, returns: z.boolean() }),
    },
  },
)

const categorized_as = edgeDef(
  { as: 'article', types: [Article] },
  { as: 'category', types: [Category] },
  // no methods
)

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

describe('SchemaDefs', () => {
  describe('SchemaClassDefs', () => {
    type Classes = SchemaClassDefs<Blog>

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

  describe('SchemaOpDefs', () => {
    type Ops = SchemaOpDefs<Blog>

    it('includes own methods on concrete nodes', () => {
      const _: Ops = 'Author.updateProfile'
      const _2: Ops = 'Author.deactivate'
      const _3: Ops = 'Article.archive'
      const _4: Ops = 'FeaturedArticle.promote'
      void [_, _2, _3, _4]
    })

    it('includes inherited methods on concrete nodes', () => {
      // Article implements Commentable (extends Publishable)
      const _publish: Ops = 'Article.publish'
      const _unpublish: Ops = 'Article.unpublish'
      const _addComment: Ops = 'Article.addComment'

      // FeaturedArticle extends Article (which implements Commentable)
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

  describe('SchemaDefs (union)', () => {
    type Defs = SchemaDefs<Blog>

    it('includes both class refs and operation refs', () => {
      const _class: Defs = 'Author'
      const _iface: Defs = 'Publishable'
      const _edge: Defs = 'wrote'
      const _op: Defs = 'Author.deactivate'
      const _inheritedOp: Defs = 'Article.publish'
      const _edgeOp: Defs = 'wrote.setPublishedAt'
      void [_class, _iface, _edge, _op, _inheritedOp, _edgeOp]
    })

    it('rejects invalid refs', () => {
      // @ts-expect-error
      const _bad1: Defs = 'Nonexistent'
      // @ts-expect-error
      const _bad2: Defs = 'Author.nonexistent'
      // @ts-expect-error
      const _bad3: Defs = ''
      void [_bad1, _bad2, _bad3]
    })
  })

  // ── Target DX: total ID mapping ─────────────────────────────────────────

  describe('total ID mapping DX', () => {
    type Defs = SchemaDefs<Blog>
    type IdMapping = { [K in Defs]: string }

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
    type Classes = SchemaClassDefs<Blog>

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
    it('SchemaClassDefs excludes operations', () => {
      assert<Equal<Includes<SchemaClassDefs<Blog>, 'Author.deactivate'>, false>>()
    })

    it('SchemaOpDefs excludes bare class names', () => {
      assert<Equal<Includes<SchemaOpDefs<Blog>, 'Author'>, false>>()
    })

    it('SchemaDefs is the union of both', () => {
      // Every class ref is in Defs
      assert<Includes<SchemaDefs<Blog>, SchemaClassDefs<Blog>>>()
      // Every op ref is in Defs
      assert<Includes<SchemaDefs<Blog>, SchemaOpDefs<Blog>>>()
    })
  })

  // ── Edge case: schema with no methods ───────────────────────────────────

  describe('schema with no methods', () => {
    const A = nodeDef({ props: { x: z.string() } })
    const B = nodeDef({})
    const a_b = edgeDef({ as: 'a', types: [A] }, { as: 'b', types: [B] })

    const NoMethodsSchema = defineSchema('no-methods.test', { A, B, a_b })
    type S = typeof NoMethodsSchema

    it('SchemaClassDefs still includes all defs', () => {
      type Classes = SchemaClassDefs<S>
      const _a: Classes = 'A'
      const _b: Classes = 'B'
      const _ab: Classes = 'a_b'
      void [_a, _b, _ab]
    })

    it('SchemaOpDefs is never when no defs have methods', () => {
      assert<Equal<SchemaOpDefs<S>, never>>()
    })

    it('SchemaDefs equals SchemaClassDefs when no methods exist', () => {
      assert<Equal<SchemaDefs<S>, SchemaClassDefs<S>>>()
    })
  })
})

// ── schemaDefs() runtime function ──────────────────────────────────────────

describe('schemaDefs()', () => {
  const refs = schemaDefs(BlogSchema)

  describe('string coercion', () => {
    it('coerces to class name via template literal', () => {
      expect(`${refs.Author}`).toBe('Author')
      expect(`${refs.Article}`).toBe('Article')
      expect(`${refs.FeaturedArticle}`).toBe('FeaturedArticle')
      expect(`${refs.Category}`).toBe('Category')
    })

    it('coerces interfaces to name', () => {
      expect(`${refs.Publishable}`).toBe('Publishable')
      expect(`${refs.Commentable}`).toBe('Commentable')
    })

    it('coerces edges to name', () => {
      expect(`${refs.wrote}`).toBe('wrote')
      expect(`${refs.categorized_as}`).toBe('categorized_as')
    })

    it('coerces via String()', () => {
      expect(String(refs.Author)).toBe('Author')
    })
  })

  describe('own method refs', () => {
    it('Author has own methods', () => {
      expect(refs.Author.updateProfile).toBe('Author.updateProfile')
      expect(refs.Author.deactivate).toBe('Author.deactivate')
    })

    it('Article has own methods', () => {
      expect(refs.Article.archive).toBe('Article.archive')
    })

    it('FeaturedArticle has own methods', () => {
      expect(refs.FeaturedArticle.promote).toBe('FeaturedArticle.promote')
    })

    it('edge wrote has own methods', () => {
      expect(refs.wrote.setPublishedAt).toBe('wrote.setPublishedAt')
    })
  })

  describe('inherited method refs', () => {
    it('Article inherits from Commentable (extends Publishable)', () => {
      expect(refs.Article.publish).toBe('Article.publish')
      expect(refs.Article.unpublish).toBe('Article.unpublish')
      expect(refs.Article.addComment).toBe('Article.addComment')
    })

    it('FeaturedArticle inherits full chain (Article + Commentable + Publishable)', () => {
      expect(refs.FeaturedArticle.archive).toBe('FeaturedArticle.archive')
      expect(refs.FeaturedArticle.publish).toBe('FeaturedArticle.publish')
      expect(refs.FeaturedArticle.unpublish).toBe('FeaturedArticle.unpublish')
      expect(refs.FeaturedArticle.addComment).toBe('FeaturedArticle.addComment')
    })
  })

  describe('interfaces have no method refs', () => {
    it('Publishable has no method properties', () => {
      const keys = Object.keys(refs.Publishable).filter((k) => k !== 'toString' && k !== 'valueOf')
      expect(keys).toEqual([])
    })

    it('Commentable has no method properties', () => {
      const keys = Object.keys(refs.Commentable).filter((k) => k !== 'toString' && k !== 'valueOf')
      expect(keys).toEqual([])
    })
  })

  describe('defs without methods have no method properties', () => {
    it('Category has no methods', () => {
      const keys = Object.keys(refs.Category).filter((k) => k !== 'toString' && k !== 'valueOf')
      expect(keys).toEqual([])
    })

    it('categorized_as has no methods', () => {
      const keys = Object.keys(refs.categorized_as).filter(
        (k) => k !== 'toString' && k !== 'valueOf',
      )
      expect(keys).toEqual([])
    })
  })

  describe('type safety', () => {
    it('refs type matches SchemaDefsMap', () => {
      const _typed: SchemaDefsMap<typeof BlogSchema> = refs
      void _typed
    })

    it('ref is typed as its literal string type', () => {
      const authorRef: 'Author' = refs.Author
      const wroteRef: 'wrote' = refs.wrote
      void [authorRef, wroteRef]
    })

    it('method property has qualified literal type', () => {
      const opRef: 'Author.deactivate' = refs.Author.deactivate
      const edgeOpRef: 'wrote.setPublishedAt' = refs.wrote.setPublishedAt
      void [opRef, edgeOpRef]
    })

    it('rejects nonexistent properties at compile time', () => {
      // @ts-expect-error — no such def in schema
      void refs.Nonexistent
      // @ts-expect-error — no such method on Author
      void refs.Author.nonexistent
    })
  })

  describe('usable as computed property keys', () => {
    it('class ref as computed key', () => {
      const obj = { [refs.Author]: 'value' } as Record<string, string>
      expect(obj.Author).toBe('value')
    })

    it('method ref as computed key', () => {
      const obj = { [refs.Author.deactivate]: 'value' } as Record<string, string>
      expect(obj['Author.deactivate']).toBe('value')
    })
  })

  describe('usable in ID mapping', () => {
    it('operation refs work directly as computed keys (plain strings)', () => {
      const opIds = {
        [refs.Author.deactivate]: 'id-1',
        [refs.Author.updateProfile]: 'id-2',
        [refs.Article.publish]: 'id-3',
        [refs.wrote.setPublishedAt]: 'id-4',
      }

      expect(opIds['Author.deactivate']).toBe('id-1')
      expect(opIds['Author.updateProfile']).toBe('id-2')
      expect(opIds['Article.publish']).toBe('id-3')
      expect(opIds['wrote.setPublishedAt']).toBe('id-4')
    })

    it('class refs coerce via template literal for indexing', () => {
      type IdMap = { [K in SchemaDefs<typeof BlogSchema>]: string }

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

      // Operation refs index directly (plain strings)
      expect(ids[refs.Author.deactivate]).toBe('id:author-deactivate')
      expect(ids[refs.Article.publish]).toBe('id:article-publish')

      // Class refs coerce to string via template literal
      expect(ids[`${refs.Author}`]).toBe('id:author')
      expect(ids[`${refs.wrote}`]).toBe('id:wrote')
    })
  })
})
