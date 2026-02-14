// parser/modifiers.ts
// ============================================================
// Modifier Parsing
//
// Handles the [modifier, modifier, ...] bracket syntax and
// all modifier forms: flags, kv pairs, cardinality, ranges,
// lifecycle, string lists.
// ============================================================

import { type Token } from '../tokens.js'
import {
  type CstChild,
  type ModifierListNode,
  type ModifierNode,
  type StringListNode,
} from '../cst/index.js'
import { DiagnosticCodes } from '../diagnostics.js'
import { type ParserContext, isDeclStart } from './index.js'

// [ Modifier, Modifier, ... ]
export function parseModifierList(p: ParserContext): ModifierListNode {
  const children: CstChild[] = []

  const lbracket = p.expect('LBracket')
  children.push(lbracket)

  const modifiers: ModifierNode[] = []

  while (!p.at('RBracket') && !p.at('EOF')) {
    // Safety: break if we've hit a declaration start (missing `]`)
    if (isDeclStart(p.current())) {
      p.diagnostics.error(
        p.current().span,
        DiagnosticCodes.P_UNCLOSED_BRACKET,
        "Unclosed '['",
      )
      break
    }

    const mod = parseModifier(p)
    modifiers.push(mod)
    children.push(mod)

    if (p.at('Comma')) {
      const comma = p.advance()
      children.push(comma)
    } else if (!p.at('RBracket')) {
      // Not a comma and not closing — error but try to continue
      break
    }
  }

  const rbracket = p.expect('RBracket')
  children.push(rbracket)

  return {
    kind: 'ModifierList',
    children,
    lbracket,
    modifiers,
    rbracket,
  }
}

/**
 * Parse a single modifier. The CST doesn't classify them — the
 * lowering pass does that. We just collect tokens intelligently:
 *
 *   flag:         Ident                          (no_self, acyclic, ...)
 *   kv:           Ident Colon Value              (format: email)
 *   cardinality:  Ident Arrow Bound              (child -> 0..1)
 *   range:        GtEq/LtEq Number               (>= 5)
 *   lifecycle:    Ident Colon Ident              (on_kill_source: cascade)
 *   in:           Ident Colon [ StringList ]     (in: ["a", "b"])
 *   length:       Ident Colon Number..Number     (length: 1..255)
 */
function parseModifier(p: ParserContext): ModifierNode {
  const children: CstChild[] = []

  // Range modifiers: >= N, <= N
  if (p.at('GtEq') || p.at('LtEq')) {
    const op = p.advance()
    children.push(op)
    const num = p.expect('NumberLit')
    children.push(num)
    return { kind: 'Modifier', children }
  }

  // Everything else starts with Ident
  const name = p.expectIdent()
  children.push(name)

  // Cardinality: name -> bound
  if (p.at('Arrow')) {
    const arrow = p.advance()
    children.push(arrow)
    parseCardinalityBound(p, children)
    return { kind: 'Modifier', children }
  }

  // KV: name : value
  if (p.at('Colon')) {
    const colon = p.advance()
    children.push(colon)

    // in: [...]
    if (p.at('LBracket')) {
      const stringList = parseStringList(p)
      children.push(stringList)
      return { kind: 'Modifier', children }
    }

    // length: N..M  or  format: ident  or  lifecycle: action
    // Peek: if we have NumberLit followed by DotDot → range
    if (p.at('NumberLit') && p.peek(1).kind === 'DotDot') {
      const min = p.advance()
      children.push(min)
      const dotdot = p.advance()
      children.push(dotdot)
      const max = p.expect('NumberLit')
      children.push(max)
      return { kind: 'Modifier', children }
    }

    // Otherwise: Ident value (format: email, on_kill_source: cascade, indexed: asc)
    if (p.at('Ident')) {
      const value = p.advance()
      children.push(value)
      return { kind: 'Modifier', children }
    }

    // Fallback: number value
    if (p.at('NumberLit')) {
      const value = p.advance()
      children.push(value)
      return { kind: 'Modifier', children }
    }
  }

  // Standalone N..M (value range, e.g. 1..100 inside modifiers)
  if (p.at('DotDot')) {
    const dotdot = p.advance()
    children.push(dotdot)
    const max = p.expect('NumberLit')
    children.push(max)
    return { kind: 'Modifier', children }
  }

  // Bare flag: just the name
  return { kind: 'Modifier', children }
}

/** Parse cardinality bound: N, N..M, N..* */
function parseCardinalityBound(p: ParserContext, children: CstChild[]): void {
  const num = p.expect('NumberLit')
  children.push(num)

  if (p.at('DotDot')) {
    const dotdot = p.advance()
    children.push(dotdot)

    if (p.at('Star')) {
      const star = p.advance()
      children.push(star)
    } else {
      const max = p.expect('NumberLit')
      children.push(max)
    }
  }
}

// ["a", "b", "c"]
function parseStringList(p: ParserContext): StringListNode {
  const children: CstChild[] = []
  const values: Token[] = []

  const lbracket = p.expect('LBracket')
  children.push(lbracket)

  if (!p.at('RBracket') && !p.at('EOF')) {
    const first = p.expect('StringLit')
    children.push(first)
    values.push(first)

    while (p.at('Comma')) {
      const comma = p.advance()
      children.push(comma)
      const str = p.expect('StringLit')
      children.push(str)
      values.push(str)
    }
  }

  const rbracket = p.expect('RBracket')
  children.push(rbracket)

  return {
    kind: 'StringList',
    children,
    lbracket,
    values,
    rbracket,
  }
}
