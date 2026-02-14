// src/lsp/semantic-tokens.ts
// ============================================================
// Semantic Tokens — Rich Token Classification
//
// Provides semantic token data for the full document.
// The LSP protocol encodes tokens as a flat array of deltas:
//   [deltaLine, deltaStartChar, length, tokenType, tokenModifiers]
//
// Token types (indexed):
//   0: type        — type names (classes, interfaces, scalars)
//   1: class       — node class names
//   2: interface   — interface names
//   3: enum        — type alias names
//   4: property    — attribute names, param names
//   5: variable    — edge names
//   6: keyword     — class, interface, type, extend, edge
//   7: string      — string literals
//   8: number      — number literals
//   9: operator    — ->, .., =, |, :
//  10: comment     — line comments
//  11: modifier    — modifier flags (unique, readonly, etc.)
// ============================================================

import { type DocumentState } from './workspace'
import { type Token, TokenKind, type Span } from '../tokens'
import { type SymbolKind as ResolverSymbolKind } from '../resolver/index'
import { type CstNode, isToken, isNode, spanOf } from '../cst/index'

export const SEMANTIC_TOKEN_TYPES = [
  'type',
  'class',
  'interface',
  'enum',
  'property',
  'variable',
  'keyword',
  'string',
  'number',
  'operator',
  'comment',
  'decorator',
] as const

export const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'abstract',
] as const

const TYPE_INDEX: Record<string, number> = {}
SEMANTIC_TOKEN_TYPES.forEach((t, i) => {
  TYPE_INDEX[t] = i
})

const MOD_INDEX: Record<string, number> = {}
SEMANTIC_TOKEN_MODIFIERS.forEach((m, i) => {
  MOD_INDEX[m] = 1 << i
})

// Keywords that get special highlighting
const KEYWORD_SET = new Set(['class', 'interface', 'type', 'extend', 'edge', 'fn'])

const MODIFIER_KEYWORDS = new Set([
  'unique',
  'readonly',
  'indexed',
  'no_self',
  'acyclic',
  'symmetric',
  'format',
  'match',
  'in',
  'length',
  'on_kill_source',
  'on_kill_target',
  'cascade',
  'unlink',
  'prevent',
  'asc',
  'desc',
])

const BUILTIN_VALUES = new Set(['true', 'false', 'null'])

export function provideSemanticTokens(state: DocumentState): number[] {
  const tokens = state.tokenIndex
  const resolved = state.result.artifacts?.resolved
  const cst = state.result.artifacts?.cst
  const lineMap = state.lineMap

  // Build sorted modifier spans for binary-search containment check
  const modifierSpans: Span[] = []
  if (cst) collectModifierSpans(cst, modifierSpans)
  modifierSpans.sort((a, b) => a.start - b.start)

  const data: number[] = []
  let prevLine = 0
  let prevChar = 0

  for (const token of tokens) {
    const inModifier = isInsideModifier(token.span, modifierSpans)
    const classification = classifyToken(token, resolved?.symbols, inModifier)
    if (!classification) continue

    const [typeIdx, modBits] = classification
    const pos = lineMap.positionAt(token.span.start)
    const length = token.span.end - token.span.start

    if (length <= 0) continue

    const deltaLine = pos.line - prevLine
    const deltaChar = deltaLine === 0 ? pos.col - prevChar : pos.col

    data.push(deltaLine, deltaChar, length, typeIdx, modBits)

    prevLine = pos.line
    prevChar = pos.col
  }

  return data
}

/** Binary-search check: is `target` fully contained by any sorted modifier span? */
function isInsideModifier(target: Span, spans: Span[]): boolean {
  let low = 0
  let high = spans.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    const s = spans[mid]
    if (target.start >= s.start && target.end <= s.end) return true
    if (target.start < s.start) high = mid - 1
    else low = mid + 1
  }
  return false
}

/** Collect span ranges of all ModifierList CST nodes. */
function collectModifierSpans(node: CstNode, out: Span[]): void {
  if (node.kind === 'ModifierList') {
    out.push(spanOf(node))
    return
  }
  for (const child of node.children) {
    if (isNode(child)) {
      collectModifierSpans(child, out)
    }
  }
}

function classifyToken(
  token: Token,
  symbols?: Map<string, { name: string; symbolKind: ResolverSymbolKind }>,
  inModifier?: boolean,
): [number, number] | null {
  switch (token.kind) {
    case 'StringLit':
      return [TYPE_INDEX.string, 0]

    case 'NumberLit':
      return [TYPE_INDEX.number, 0]

    case 'Arrow':
    case 'DotDot':
    case 'Eq':
    case 'Pipe':
    case 'GtEq':
    case 'LtEq':
      return [TYPE_INDEX.operator, 0]

    case 'Colon':
      return [TYPE_INDEX.operator, 0]

    case 'Star':
    case 'Question':
      return [TYPE_INDEX.operator, 0]

    case 'Ident':
      return classifyIdent(token, symbols, inModifier)

    default:
      return null
  }
}

function classifyIdent(
  token: Token,
  symbols?: Map<string, { name: string; symbolKind: ResolverSymbolKind }>,
  inModifier?: boolean,
): [number, number] | null {
  const text = token.text

  // Language keywords
  if (KEYWORD_SET.has(text)) {
    return [TYPE_INDEX.keyword, 0]
  }

  // Builtin values
  if (BUILTIN_VALUES.has(text)) {
    return [TYPE_INDEX.keyword, 0]
  }

  // Modifier keywords — only classify as decorator when actually inside [...]
  if (inModifier && MODIFIER_KEYWORDS.has(text)) {
    return [TYPE_INDEX.decorator, 0]
  }

  // now() function name
  if (text === 'now') {
    return [TYPE_INDEX.variable, 0]
  }

  // any (in edge<any>)
  if (text === 'any') {
    return [TYPE_INDEX.keyword, 0]
  }

  // Resolved symbol
  if (symbols) {
    const sym = symbols.get(text)
    if (sym) {
      switch (sym.symbolKind) {
        case 'Scalar':
          return [TYPE_INDEX.type, 0]
        case 'TypeAlias':
          return [TYPE_INDEX.enum, 0]
        case 'Interface':
          return [TYPE_INDEX.interface, MOD_INDEX.abstract]
        case 'Class':
          return [TYPE_INDEX.class, 0]
        case 'Edge':
          return [TYPE_INDEX.variable, 0]
      }
    }
  }

  // Unresolved — likely an attribute name or param name
  return [TYPE_INDEX.property, 0]
}
