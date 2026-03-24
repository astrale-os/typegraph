// src/lsp/server.ts
// ============================================================
// Language Server — stdio Transport
//
// Full LSP implementation for .gsl files:
//   ✓ Diagnostics (on open / change / save)
//   ✓ Hover (type signatures + constraints)
//   ✓ Go-to-Definition
//   ✓ Completion (context-aware)
//   ✓ Document Symbols (outline)
//   ✓ Semantic Tokens (full)
// ============================================================

import {
  createConnection,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver/node.js'

import { type Prelude } from '../prelude'
import { type SchemaRegistry } from '../registry'
import { provideCompletion } from './completion'
import { provideDefinition } from './definition'
import { provideHover } from './hover'
import {
  provideSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
} from './semantic-tokens'
import { provideDocumentSymbols } from './symbols'
import { Workspace } from './workspace'

export function startServer(prelude?: Prelude, registry?: SchemaRegistry): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
  const workspace = new Workspace(prelude, registry)

  // Debounce timers per-document — avoids recompiling on every keystroke
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const DEBOUNCE_MS = 120

  function scheduleRecompile(uri: string, text: string, version: number): void {
    const existing = debounceTimers.get(uri)
    if (existing) clearTimeout(existing)

    debounceTimers.set(
      uri,
      setTimeout(() => {
        debounceTimers.delete(uri)
        const diagnostics = workspace.update(uri, text, version)
        connection.sendDiagnostics({ uri, diagnostics })
      }, DEBOUNCE_MS),
    )
  }

  // ─── Initialize ────────────────────────────────────────────

  connection.onInitialize((): InitializeResult => {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,

        hoverProvider: true,

        definitionProvider: true,

        completionProvider: {
          triggerCharacters: [':', '[', '=', '<', '|', ',', ' '],
          resolveProvider: false,
        },

        documentSymbolProvider: true,

        semanticTokensProvider: {
          legend: {
            tokenTypes: [...SEMANTIC_TOKEN_TYPES],
            tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
          },
          full: true,
        },
      },
    }
  })

  // ─── Document Lifecycle ────────────────────────────────────

  connection.onDidOpenTextDocument((params) => {
    const { uri, text, version } = params.textDocument
    const diagnostics = workspace.update(uri, text, version)
    connection.sendDiagnostics({ uri, diagnostics })
  })

  connection.onDidChangeTextDocument((params) => {
    const { uri, version } = params.textDocument
    const text = params.contentChanges[0]?.text ?? workspace.get(uri)?.document.getText()
    if (text === null || text === undefined) return
    scheduleRecompile(uri, text, version)
  })

  connection.onDidCloseTextDocument((params) => {
    const timer = debounceTimers.get(params.textDocument.uri)
    if (timer) {
      clearTimeout(timer)
      debounceTimers.delete(params.textDocument.uri)
    }
    workspace.remove(params.textDocument.uri)
    connection.sendDiagnostics({ uri: params.textDocument.uri, diagnostics: [] })
  })

  // ─── Hover ─────────────────────────────────────────────────

  connection.onHover((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return null

    const offset = state.lineMap.offsetAt(params.position.line, params.position.character)

    return provideHover(workspace, state, offset)
  })

  // ─── Definition ────────────────────────────────────────────

  connection.onDefinition((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return null

    const offset = state.lineMap.offsetAt(params.position.line, params.position.character)

    return provideDefinition(workspace, state, offset)
  })

  // ─── Completion ────────────────────────────────────────────

  connection.onCompletion((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return []

    const offset = state.lineMap.offsetAt(params.position.line, params.position.character)

    return provideCompletion(workspace, state, offset)
  })

  // ─── Document Symbols ──────────────────────────────────────

  connection.onDocumentSymbol((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return []

    return provideDocumentSymbols(state)
  })

  // ─── Semantic Tokens ───────────────────────────────────────

  connection.languages.semanticTokens.on((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return { data: [] }

    const data = provideSemanticTokens(state)
    return { data }
  })

  // ─── Start ─────────────────────────────────────────────────

  connection.listen()
}
