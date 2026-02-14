// src/kernel-prelude.ts
// ============================================================
// The Kernel Prelude — Astrale's graph meta-model
//
// This module defines the Kernel prelude: the types and edges
// that make up Astrale's type system. It is NOT part of the
// compiler core — just one instance of the Prelude interface.
//
// Import this when you need to compile schemas that extend the
// kernel (the default for Astrale users).
// ============================================================

import type { Prelude } from './prelude.js'

export const KERNEL_PRELUDE: Prelude = {
  scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp', 'Bitmask', 'ByteString'],
  source: `\
-- kernel.krl — The Kernel Prelude

-- Root Abstractions
interface Node {}

interface Link {}

-- Meta-Model
class Class: Node {}

class Interface: Node {}

-- Structural Edges
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

-- Type System Edges
class implements(class: Class, interface: Interface) [
  no_self
]

class extends(child: Interface, parent: Interface) [
  no_self,
  acyclic
]

-- Permission Edges
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
`,
  defaultFunctions: ['now'],
}
