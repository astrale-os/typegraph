-- ============================================================
-- kernel.krl — The Kernel Prelude (v3)
-- ============================================================
-- Parsed by the compiler before any user schema.
-- Every declaration here bootstraps the type system itself.
--
-- Primitive types (String, Int, Float, Boolean, Timestamp,
-- Bitmask, ByteString) are compiler builtins — they exist
-- in the primal scope before this file is parsed.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Root Abstractions
-- ────────────────────────────────────────────────────────────

interface Node {}

interface Link {}

-- ────────────────────────────────────────────────────────────
-- Meta-Model
-- ────────────────────────────────────────────────────────────

class Class: Node {}

class Interface: Node {}

-- ────────────────────────────────────────────────────────────
-- Structural Edges
-- ────────────────────────────────────────────────────────────

class has_parent(child: Node, parent: Node) [
  no_self,
  acyclic,
  child -> 0..1
]

class instance_of(instance: Node | Link, type: Class) [
  instance -> 1
]

class has_link(source: Node, link: Link) [
  link -> 1
]

class links_to(link: Link, target: Node) [
  link -> 1
]

-- ────────────────────────────────────────────────────────────
-- Type System Edges
-- ────────────────────────────────────────────────────────────

class implements(class: Class, interface: Interface) [
  no_self
]

class extends(child: Interface, parent: Interface) [
  no_self,
  acyclic
]

-- ────────────────────────────────────────────────────────────
-- Permission Edges
-- ────────────────────────────────────────────────────────────

interface Identity: Node {}

class has_perm(identity: Identity, target: Node) {
  perm: Bitmask
}

class excluded_from(subject: Identity, excluded: Identity) [
  no_self,
  acyclic
]

class constrained_by(subject: Identity, constraint: Identity) [
  no_self,
  acyclic
]

class extends_with(subject: Identity, extension: Identity) [
  no_self,
  acyclic
]
