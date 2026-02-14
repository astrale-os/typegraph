// src/lsp/completion.ts
// ============================================================
// Completion Provider — Context-Aware Suggestions
//
// Completion contexts:
//   - Declaration start     → class, interface, type, extend
//   - After `:` (extends)   → interface/class names
//   - Type position         → all type names (scalars, aliases, classes, interfaces)
//   - Inside `[...]`        → modifier names
//   - After `=`             → true, false, null, now(), string/number literals
//   - `edge<`              → edge names + "any"
// ============================================================

import {
  type CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from 'vscode-languageserver-types'
import { type Workspace, type DocumentState } from './workspace'
import { type SymbolKind } from '../resolver/index'

const DECL_KEYWORDS: CompletionItem[] = [
  {
    label: 'class',
    kind: CompletionItemKind.Keyword,
    insertText: 'class ${1:Name} {\n  $0\n}',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Node or edge class',
  },
  {
    label: 'interface',
    kind: CompletionItemKind.Keyword,
    insertText: 'interface ${1:Name} {\n  $0\n}',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Abstract interface',
  },
  {
    label: 'type',
    kind: CompletionItemKind.Keyword,
    insertText: 'type ${1:Name} = ${2:String}',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Type alias',
  },
  {
    label: 'extend',
    kind: CompletionItemKind.Keyword,
    insertText: 'extend "${1:uri}" { ${2:Type} }',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Extension import',
  },
]

const MODIFIER_ITEMS: CompletionItem[] = [
  { label: 'unique', kind: CompletionItemKind.Property, detail: 'Uniqueness constraint' },
  { label: 'readonly', kind: CompletionItemKind.Property, detail: 'Immutable after creation' },
  { label: 'indexed', kind: CompletionItemKind.Property, detail: 'Database index' },
  {
    label: 'indexed: asc',
    kind: CompletionItemKind.Property,
    insertText: 'indexed: asc',
    detail: 'Ascending index',
  },
  {
    label: 'indexed: desc',
    kind: CompletionItemKind.Property,
    insertText: 'indexed: desc',
    detail: 'Descending index',
  },
  { label: 'no_self', kind: CompletionItemKind.Property, detail: 'Prevent self-loops (edges)' },
  { label: 'acyclic', kind: CompletionItemKind.Property, detail: 'Prevent cycles (edges)' },
  { label: 'symmetric', kind: CompletionItemKind.Property, detail: 'Bidirectional edge' },
  {
    label: 'format: email',
    kind: CompletionItemKind.Property,
    insertText: 'format: email',
    detail: 'Email format',
  },
  {
    label: 'format: url',
    kind: CompletionItemKind.Property,
    insertText: 'format: url',
    detail: 'URL format',
  },
  {
    label: 'format: uuid',
    kind: CompletionItemKind.Property,
    insertText: 'format: uuid',
    detail: 'UUID format',
  },
  {
    label: 'format: slug',
    kind: CompletionItemKind.Property,
    insertText: 'format: slug',
    detail: 'Slug format',
  },
  {
    label: 'in: [...]',
    kind: CompletionItemKind.Property,
    insertText: 'in: ["${1:value}"]',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Enum values',
  },
  {
    label: 'length: N..M',
    kind: CompletionItemKind.Property,
    insertText: 'length: ${1:1}..${2:255}',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Length bounds',
  },
  {
    label: 'on_kill_source: cascade',
    kind: CompletionItemKind.Property,
    insertText: 'on_kill_source: cascade',
    detail: 'Cascade on source deletion',
  },
  {
    label: 'on_kill_target: cascade',
    kind: CompletionItemKind.Property,
    insertText: 'on_kill_target: cascade',
    detail: 'Cascade on target deletion',
  },
]

const DEFAULT_VALUE_ITEMS: CompletionItem[] = [
  { label: 'true', kind: CompletionItemKind.Value },
  { label: 'false', kind: CompletionItemKind.Value },
  { label: 'null', kind: CompletionItemKind.Value },
  { label: 'now()', kind: CompletionItemKind.Function, detail: 'Current timestamp' },
  {
    label: '""',
    kind: CompletionItemKind.Value,
    insertText: '"${1}"',
    insertTextFormat: InsertTextFormat.Snippet,
  },
  { label: '0', kind: CompletionItemKind.Value },
]

const FN_SNIPPET: CompletionItem = {
  label: 'fn',
  kind: CompletionItemKind.Keyword,
  insertText: 'fn ${1:name}(${2}): ${3:ReturnType}',
  insertTextFormat: InsertTextFormat.Snippet,
  detail: 'Method declaration',
}

export function provideCompletion(
  workspace: Workspace,
  state: DocumentState,
  offset: number,
): CompletionItem[] {
  const text = state.document.getText()
  const context = inferContext(text, offset)

  switch (context) {
    case 'declaration':
      return DECL_KEYWORDS

    case 'type':
      return typeCompletions(state)

    case 'extends':
      return extendsCompletions(state)

    case 'modifier':
      return MODIFIER_ITEMS

    case 'default':
      return DEFAULT_VALUE_ITEMS

    case 'edge_target':
      return edgeTargetCompletions(state)

    case 'body':
      return [FN_SNIPPET, ...typeCompletions(state)]

    default:
      // Fallback: offer everything
      return [...DECL_KEYWORDS, ...typeCompletions(state)]
  }
}

type CompletionContext =
  | 'declaration'
  | 'type'
  | 'extends'
  | 'modifier'
  | 'default'
  | 'edge_target'
  | 'body'
  | 'unknown'

/**
 * Infer completion context from the text before the cursor.
 * Simple heuristic-based approach that covers the common cases.
 */
function inferContext(text: string, offset: number): CompletionContext {
  // Look backwards from cursor position for context clues
  const before = text.slice(Math.max(0, offset - 200), offset)
  const trimmed = before.trimEnd()

  // Inside [...] → modifiers
  const lastOpen = before.lastIndexOf('[')
  const lastClose = before.lastIndexOf(']')
  if (lastOpen > lastClose) return 'modifier'

  // After `=` → default value
  if (/=\s*$/.test(trimmed)) return 'default'

  // After `:` in extends position (after class/interface name, before `{`)
  // or in attribute type position (name: |)
  if (/:\s*$/.test(trimmed)) {
    // Is this after a class/interface header?
    if (/(?:class|interface)\s+\w+\s*:\s*$/.test(trimmed)) return 'extends'
    // Attribute type position
    return 'type'
  }

  // After `|` → union type member
  if (/\|\s*$/.test(trimmed)) return 'type'

  // After `edge<` → edge target
  if (/edge\s*<\s*$/.test(trimmed)) return 'edge_target'

  // After `,` inside extends → more type names
  if (/(?:class|interface)\s+\w+\s*:\s*[\w,\s]+,\s*$/.test(trimmed)) return 'extends'

  // Inside body braces → attribute or method start
  const lastBrace = before.lastIndexOf('{')
  const lastCloseBrace = before.lastIndexOf('}')
  if (lastBrace > lastCloseBrace) return 'body'

  // Start of line or after `}` → new declaration
  if (/(?:^|\n|}\s*)\s*$/.test(before)) return 'declaration'

  return 'unknown'
}

function typeCompletions(state: DocumentState): CompletionItem[] {
  const items: CompletionItem[] = []
  const resolved = state.result.artifacts?.resolved

  if (resolved) {
    for (const [name, sym] of resolved.symbols) {
      items.push({
        label: name,
        kind: symbolKindToCompletion(sym.symbolKind),
        detail: sym.symbolKind === 'Scalar' ? 'Builtin scalar' : sym.symbolKind,
      })
    }
  }

  // edge<T> snippet
  items.push({
    label: 'edge<>',
    kind: CompletionItemKind.TypeParameter,
    insertText: 'edge<${1:any}>',
    insertTextFormat: InsertTextFormat.Snippet,
    detail: 'Edge reference type',
  })

  return items
}

function extendsCompletions(state: DocumentState): CompletionItem[] {
  const items: CompletionItem[] = []
  const resolved = state.result.artifacts?.resolved
  if (!resolved) return items

  for (const [name, sym] of resolved.symbols) {
    if (sym.symbolKind === 'Interface') {
      items.push({
        label: name,
        kind: CompletionItemKind.Interface,
        detail: 'Interface',
      })
    }
  }

  return items
}

function edgeTargetCompletions(state: DocumentState): CompletionItem[] {
  const items: CompletionItem[] = [
    { label: 'any', kind: CompletionItemKind.Keyword, detail: 'Any edge type' },
  ]
  const resolved = state.result.artifacts?.resolved
  if (!resolved) return items

  for (const [name, sym] of resolved.symbols) {
    if (sym.symbolKind === 'Edge') {
      items.push({
        label: name,
        kind: CompletionItemKind.Reference,
        detail: 'Edge type',
      })
    }
  }

  return items
}

function symbolKindToCompletion(kind: SymbolKind): CompletionItemKind {
  switch (kind) {
    case 'Scalar':
      return CompletionItemKind.TypeParameter
    case 'TypeAlias':
      return CompletionItemKind.TypeParameter
    case 'Interface':
      return CompletionItemKind.Interface
    case 'Class':
      return CompletionItemKind.Class
    case 'Edge':
      return CompletionItemKind.Reference
    default:
      return CompletionItemKind.Text
  }
}
