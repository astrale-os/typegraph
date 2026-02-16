// Genesis data — bootstrap a workspace with teams, spaces, and permissions.
// This example shows how application types integrate with the kernel prelude's
// Identity and permission model (has_perm, excluded_from, etc.).

import { defineCore, node, edge } from './schema.generated'

export const core = defineCore({
  nodes: {
    // ─── Identities (Users & Teams) ────────────────────────
    root: node('User', { email: 'root@astrale.ai', name: 'Root' }),
    alice: node('User', { email: 'alice@acme.com', name: 'Alice' }),
    bob: node('User', { email: 'bob@acme.com', name: 'Bob' }),

    acme: node('Team', { name: 'Acme Corp', slug: 'acme' }),

    // ─── Spaces & Documents ────────────────────────────────
    engineering: node('Space', { name: 'Engineering' }),
    design: node('Space', { name: 'Design' }),

    roadmap: node('Document', { title: 'Q3 Roadmap' }),
    onboarding: node('Document', { title: 'Onboarding Guide' }),
  },

  edges: [
    // Team membership
    edge('memberOf', { user: 'alice', team: 'acme' }, { role: 'admin' }),
    edge('memberOf', { user: 'bob', team: 'acme' }, { role: 'member' }),

    // Ownership: team → space (1:1 via cardinality constraint)
    edge('owns', { team: 'acme', space: 'engineering' }),
    edge('owns', { team: 'acme', space: 'design' }),

    // Containment: space → documents
    edge('contains', { space: 'engineering', document: 'roadmap' }),
    edge('contains', { space: 'engineering', document: 'onboarding' }),
  ],
})
