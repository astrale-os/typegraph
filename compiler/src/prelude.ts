// src/prelude.ts
// ============================================================
// Prelude — Pluggable compiler configuration
//
// A Prelude defines the base environment the compiler starts
// from: which scalar types exist, what source code is parsed
// before user code, and which default-value functions are
// recognized.
//
// The compiler itself is prelude-agnostic. The Kernel prelude
// is just one instance, provided from outside.
// ============================================================

export interface Prelude {
  /** Primitive types injected into the scope before any source is parsed. */
  readonly scalars: readonly string[];
  /** Source code parsed and resolved before user code (can be empty). */
  readonly source: string;
  /** Known default-value function names (e.g., 'now'). */
  readonly defaultFunctions: readonly string[];
}

/** Minimal prelude: common scalars, no prelude source, no default functions. */
export const DEFAULT_PRELUDE: Prelude = {
  scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp'],
  source: '',
  defaultFunctions: ['now'],
};
