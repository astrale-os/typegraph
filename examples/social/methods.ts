// Method implementations for the social domain — defined as kernel operations.

import { method } from '@astrale-os/kernel'
import { UserOps, PostOps } from './schema.generated'

export const UserMethods = [
  method.internal(UserOps.followerCount, {
    authorize: ({ self }) => ({ nodeIds: [self.id], perm: 'read' }),
    execute: async ({ self, kernel, auth }) => {
      return kernel.graph.as(auth).node('User').byId(self.id).from('follows').count()
    },
  }),

  method.internal(UserOps.isFollowing, {
    authorize: ({ self }) => ({ nodeIds: [self.id], perm: 'read' }),
    execute: async ({ self, params, kernel, auth }) => {
      const edges = await kernel.graph
        .as(auth)
        .node('User')
        .byId(self.id)
        .to('follows')
        .where('id', 'eq', params.other.id)
        .count()
      return edges > 0
    },
  }),
]

export const PostMethods = [
  method.internal(PostOps.likeCount, {
    authorize: ({ self }) => ({ nodeIds: [self.id], perm: 'read' }),
    execute: async ({ self, kernel, auth }) => {
      return kernel.graph.as(auth).node('Post').byId(self.id).from('liked').count()
    },
  }),
]
