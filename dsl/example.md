-- Kernel Schema
-- This schema is self-describing: every declaration here
-- is itself an instance of the types it defines.

-- Root abstractions
interface Node {}

interface Link {}

-- Meta-types (types of types)
class Class: Node {}

class Interface: Node {}

-- Identity (for permissions)
interface Identity: Node {}

-- Graph structure
class has_parent(child: Node, parent: Node) [
  no_self,
  acyclic,
  child -> 0..1
]

class instance_of(instance: Node | Link, type: Class) [instance -> 1]

class has_link(source: Node, link: Link) [link -> 1]

class links_to(link: Link, target: Node) [link -> 1]

-- Type system
class implements(class: Class, interface: Interface) [no_self]

class extends(child: Interface, parent: Interface) [no_self, acyclic]

-- Permissions
class has_perm(identity: Identity, target: Node) {
  perm: Bitmask
}

-- Identity constraints
class excluded_from(subject: Identity, excluded: Identity) [no_self, acyclic]

class constrained_by(subject: Identity, constraint: Identity) [no_self, acyclic]

class extends_with(subject: Identity, extension: Identity) [no_self, acyclic]