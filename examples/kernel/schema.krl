-- Kernel Integration
-- Demonstrates: extending the kernel prelude, Identity, permission
-- edges, the meta-model (Class, Interface), and authorization structures.

extend "https://kernel.astrale.ai/v1" {
  Identity,
  Class,
  Interface,
  has_parent,
  has_perm,
  excluded_from,
  constrained_by,
  extends_with,
  instance_of,
  implements
}

-- ─── Application Types ───────────────────────────────────────

interface Timestamped {
  createdAt: Timestamp = now(),
  updatedAt: Timestamp?
}

class User: Identity, Timestamped {
  email: String [unique],
  name: String
}

class Team: Identity, Timestamped {
  name: String [unique],
  slug: String [unique]
}

class Space: Timestamped {
  name: String,
  description: String?
}

class Document: Timestamped {
  title: String,
  content: String?
}

-- ─── Domain Edges ────────────────────────────────────────────

class memberOf(user: User, team: Team) [] {
  role: String
}

class owns(team: Team, space: Space) [space -> 1]

class contains(space: Space, document: Document) []
