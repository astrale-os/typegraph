// Kernel core — genesis data seeded at boot time.
//
// The system identity is the kernel's root actor.
// All meta-model nodes (Class, Interface) created by materializeSchema()
// will point to this node via has_parent.

import { ALL } from '@astrale-os/kernel-core'
import { defineCore, node, edge } from './schema.generated'

export const core = defineCore({
  nodes: {
    system: node('Root', {}),
  },
  edges: [
    // System identity has full permissions on itself
    edge('has_perm', { identity: 'system', target: 'system' }, { perm: ALL }),
  ],
})
