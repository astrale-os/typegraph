import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { createQueryBuilder, defineSchema, node, edge } from '../../src'

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

describe('Per-node ID typing', () => {
  it('returns branded id for operation nodes', () => {
    const operationId = 'op_1' as OperationId
    const query = graph.node('operation').byId(operationId)
    type Result = Awaited<ReturnType<typeof query.execute>>
    expectTypeOf<Result['id']>().toEqualTypeOf<OperationId>()
  })

  it('enforces module id type in byId', () => {
    const moduleId = 'mod_1' as ModuleId
    graph.node('module').byId(moduleId)

    // @ts-expect-error module query requires ModuleId, not OperationId
    graph.node('module').byId('op_1' as OperationId)
  })
})
