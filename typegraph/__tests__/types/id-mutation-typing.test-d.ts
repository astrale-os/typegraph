import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { createQueryBuilder, defineSchema, edge, node, type GraphMutations } from '../../src'

type OperationId = string & { readonly __operationId: true }
type ModuleId = string & { readonly __moduleId: true }

const schema = defineSchema({
  nodes: {
    operation: node({
      properties: {
        name: z.string(),
      },
    }),
    module: node({
      properties: {
        name: z.string(),
      },
    }),
  },
  edges: {
    hasParent: edge({
      from: 'module',
      to: 'module',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
})

type IdMap = {
  operation: OperationId
  module: ModuleId
}

const graph = createQueryBuilder<typeof schema, IdMap>(schema)
const mutations = null as unknown as GraphMutations<typeof schema, IdMap>

describe('ID typing for query + mutations', () => {
  it('nodeByIdWithLabel enforces label-specific ID type', () => {
    const moduleId = 'mod_1' as ModuleId
    graph.nodeByIdWithLabel('module', moduleId)

    // @ts-expect-error module label should not accept OperationId
    graph.nodeByIdWithLabel('module', 'op_1' as OperationId)
  })

  it('GraphMutations carries typed node IDs in signatures', () => {
    const moduleId = 'mod_1' as ModuleId
    const operationId = 'op_1' as OperationId

    if (false) {
      const created = mutations.create('module', { name: 'ok' })
      void created.then((node) => {
        mutations.update('module', node.id, { name: 'roundtrip' })
      })

      mutations.update('module', moduleId, { name: 'ok' })
      mutations.delete('module', moduleId)
      mutations.upsert('module', moduleId, { name: 'ok' })

      // @ts-expect-error module operations should reject OperationId
      mutations.update('module', operationId, { name: 'bad' })
      // @ts-expect-error module operations should reject OperationId
      mutations.delete('module', operationId)
      // @ts-expect-error module operations should reject OperationId
      mutations.upsert('module', operationId, { name: 'bad' })
    }

    expectTypeOf(moduleId).toEqualTypeOf<ModuleId>()
  })
})
