// SDK usage — social network queries and interactions.

import { schema } from './schema.generated'
import { core } from './core'
import { methods } from './methods'

const graph = await createGraph(schema, {
  adapter: new MemoryAdapter(),
  core,
  methods,
})

// ─── Queries ─────────────────────────────────────────────────

// All users
const users = await graph.node('User').execute()
// → UserNode[] (typed: { id, __type, username, bio?, ... } & UserMethods)

// Find a user by unique field
const [alice] = await graph.node('User').where('username', 'eq', 'alice').limit(1).execute()

// ─── Self-Referencing Traversals ─────────────────────────────

// Who does alice follow?
const following = await graph.node('User').byId(alice.id).to('follows').execute()
// → UserNode[] (bob)

// Who follows alice? (reverse traversal)
const followers = await graph.node('User').byId(alice.id).from('follows').execute()
// → UserNode[] (bob, charlie)

// ─── Method Calls ────────────────────────────────────────────

const count = await alice.followerCount()
// → 2

const bob = await graph.node('User').byId('bob').execute()
const doesFollow = await alice.isFollowing({ other: bob })
// → true

// ─── Posts & Likes ───────────────────────────────────────────

// Get alice's posts (forward traversal through authored edge)
const alicePosts = await graph.node('User').byId(alice.id).to('authored').execute()

// Like count on a post
const post = alicePosts[0]
const likes = await post.likeCount()
// → 2

// ─── Mutations ───────────────────────────────────────────────

// Follow someone (with constraint enforcement: no_self, unique)
await graph.mutate.link('follows', alice.id, 'charlie')

// Create a new post and link it
const newPost = await graph.mutate.create('Post', {
  body: 'Just shipped a new feature!',
})
await graph.mutate.link('authored', alice.id, newPost.id)
