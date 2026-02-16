// Method implementations for the social domain — defined as kernel operations.

import { defineOperation } from '@astrale-os/kernel'
import { UserOps, PostOps } from './schema.generated'

export const UserMethods = [
  defineOperation.internal(UserOps.followerCount, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'read' }),
    execute: async ({ self, kernel, auth }) => {
      return kernel.graph.as(auth).node('User').byId(self!.id).from('follows').count()
    },
  }),

  defineOperation.internal(UserOps.isFollowing, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'read' }),
    execute: async ({ self, params, kernel, auth }) => {
      const edges = await kernel.graph
        .as(auth)
        .node('User')
        .byId(self!.id)
        .to('follows')
        .where('id', 'eq', params.other.id)
        .count()
      return edges > 0
    },
  }),
]

export const PostMethods = [
  defineOperation.internal(PostOps.likeCount, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'read' }),
    execute: async ({ self, kernel, auth }) => {
      return kernel.graph.as(auth).node('Post').byId(self!.id).from('liked').count()
    },
  }),
]
