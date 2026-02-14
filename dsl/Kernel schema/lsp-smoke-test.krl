extend "https://kernel.astrale.ai/v1" { Identity }

type Email = String [format: email]

interface Timestamped {
  created_at: Timestamp [readonly] = now(),
  updated_at: Timestamp?
}

class User: Identity, Timestamped {
  username: String [unique]
  email: Email [unique]
}

class follows(follower: User, followee: User) [no_self, unique] {
  created_at: Timestamp = now()
}

class Name {
  full: String
}