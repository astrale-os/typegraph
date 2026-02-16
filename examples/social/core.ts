// Genesis data — seed users and initial content.

import { defineCore, node, edge } from './schema.generated'

export const core = defineCore({
  nodes: {
    alice: node('User', { username: 'alice', bio: 'Building things' }),
    bob: node('User', { username: 'bob' }),
    charlie: node('User', { username: 'charlie', bio: 'Lurker' }),

    hello_world: node('Post', { body: 'Hello world!' }),
    first_post: node('Post', { body: 'My first post here.' }),
  },

  edges: [
    edge('authored', { author: 'alice', post: 'hello_world' }),
    edge('authored', { author: 'bob', post: 'first_post' }),

    edge('follows', { follower: 'alice', followed: 'bob' }, { since: new Date().toISOString() }),
    edge('follows', { follower: 'bob', followed: 'alice' }, { since: new Date().toISOString() }),
    edge(
      'follows',
      { follower: 'charlie', followed: 'alice' },
      { since: new Date().toISOString() },
    ),

    edge('liked', { user: 'bob', post: 'hello_world' }),
    edge('liked', { user: 'charlie', post: 'hello_world' }),
  ],
})
