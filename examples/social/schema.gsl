-- Social Network Domain
-- Demonstrates: self-referencing edges, no_self/unique constraints,
-- one-to-many cardinality, methods.

extend "https://kernel.astrale.ai/v1" { Identity }

-- ─── Interfaces ──────────────────────────────────────────────

interface Timestamped {
  createdAt: Timestamp = now()
}

-- ─── Nodes ───────────────────────────────────────────────────

class User: Identity, Timestamped {
  username: String [unique],
  bio: String?,

  fn followerCount(): Int,
  fn isFollowing(other: User): Boolean
}

class Post: Timestamped {
  body: String,

  fn likeCount(): Int
}

-- ─── Edges ───────────────────────────────────────────────────

class follows(follower: User, followed: User) [no_self, unique] {
  since: Timestamp = now()
}

class liked(user: User, post: Post) [unique]

class authored(author: User, post: Post) [post -> 1]
