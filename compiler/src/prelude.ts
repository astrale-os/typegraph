// src/prelude.ts
// ============================================================
// Prelude — Compiler builtins configuration
//
// A Prelude defines the true language primitives: which scalar
// types exist and which default-value functions are recognized.
//
// The compiler itself is prelude-agnostic. The Kernel prelude
// is just one instance, provided from outside.
// ============================================================

export interface Prelude {
  /** Primitive types injected into the scope before any source is parsed. */
  readonly scalars: readonly string[]
  /** Known default-value function names (e.g., 'now'). */
  readonly defaultFunctions: readonly string[]
}

/** Minimal prelude: common scalars + default functions. */
export const DEFAULT_PRELUDE: Prelude = {
  scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp'],
  defaultFunctions: ['now'],
}

/** Kernel prelude: adds Bitmask and ByteString to the scalar set. */
export const KERNEL_PRELUDE: Prelude = {
  scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp', 'Bitmask', 'ByteString'],
  defaultFunctions: ['now'],
}
