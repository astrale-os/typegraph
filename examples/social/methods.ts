import { defineUserMethods, definePostMethods, UserOps, PostOps } from './schema.generated'
import { READ } from '@astrale-os/kernel-core'

export const UserMethods = defineUserMethods(UserOps, {
  followerCount: {
    authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
    execute: async ({ self, kernel, auth }) => {
      return kernel.graph.as(auth).node('User').byId(self.id).from('follows').count()
    },
  },
  isFollowing: {
    authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
    execute: async ({ self, params, kernel, auth }) => {
      const edges = await kernel.graph
        .as(auth)
        .node('User')
        .byId(self.id)
        .to('follows')
        .where('id', 'eq', params.other)
        .count()
      return edges > 0
    },
  },
})

export const PostMethods = definePostMethods(PostOps, {
  likeCount: {
    authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
    execute: async ({ self, kernel, auth }) => {
      return kernel.graph.as(auth).node('Post').byId(self.id).from('liked').count()
    },
  },
})
