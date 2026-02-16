// Method implementations for the social domain.

import type { MethodsConfig } from './schema.generated'

export const methods: MethodsConfig = {
  User: {
    async followerCount(ctx) {
      // Count incoming 'follows' edges where this user is the followed endpoint.
      const followers = await ctx.graph.node('User').byId(ctx.self.id).from('follows').count()
      return followers
    },

    async isFollowing(ctx) {
      // Check if an edge exists: self --follows--> other
      const edges = await ctx.graph
        .node('User')
        .byId(ctx.self.id)
        .to('follows')
        .where('id', 'eq', ctx.args.other.id)
        .count()
      return edges > 0
    },
  },

  Post: {
    async likeCount(ctx) {
      const likes = await ctx.graph.node('Post').byId(ctx.self.id).from('liked').count()
      return likes
    },
  },
}
