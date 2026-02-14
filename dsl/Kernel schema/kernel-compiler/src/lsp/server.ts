// src/lsp/server.ts
// ============================================================
// Language Server — stdio Transport
//
// Full LSP implementation for .krl files:
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
import { Workspace } from './workspace.js'
import { type Prelude } from '../prelude.js'
import { provideHover } from './hover.js'
import { provideDefinition } from './definition.js'
import { provideCompletion } from './completion.js'
import { provideDocumentSymbols } from './symbols.js'
import {
  provideSemanticTokens,
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
} from './semantic-tokens.js'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const LOG_PATH = '/tmp/krl-lsp-debug.log'

function log(msg: string): void {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}

export function startServer(prelude?: Prelude): void {
  writeFileSync(LOG_PATH, `=== KRL LSP started at ${new Date().toISOString()} ===\n`)
  log(`PID: ${process.pid}`)

  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout)
  const workspace = new Workspace(prelude)

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
        const t0 = performance.now()
        try {
          const diagnostics = workspace.update(uri, text, version)
          const ms = (performance.now() - t0).toFixed(1)
          log(`recompile v${version} → ${diagnostics.length} diags (${ms}ms)`)
          connection.sendDiagnostics({ uri, diagnostics })
        } catch (err) {
          log(`recompile CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
        }
      }, DEBOUNCE_MS),
    )
  }

  // ─── Initialize ────────────────────────────────────────────

  connection.onInitialize((): InitializeResult => {
    log('onInitialize')
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,

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
    log(`open ${params.textDocument.uri} v${params.textDocument.version}`)
    const { uri, text, version } = params.textDocument
    try {
      const diagnostics = workspace.update(uri, text, version)
      log(`open compiled → ${diagnostics.length} diags`)
      connection.sendDiagnostics({ uri, diagnostics })
    } catch (err) {
      log(`open CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
    }
  })

  connection.onDidChangeTextDocument((params) => {
    const { uri, version } = params.textDocument
    log(`change ${uri} v${version} (${params.contentChanges.length} changes)`)
    try {
      const text = workspace.applyChanges(uri, params.contentChanges, version)
      if (text == null) {
        log('change: applyChanges returned null (no doc)')
        return
      }
      scheduleRecompile(uri, text, version)
    } catch (err) {
      log(`change CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
    }
  })

  connection.onDidCloseTextDocument((params) => {
    log(`close ${params.textDocument.uri}`)
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
    try {
      const offset = state.lineMap.offsetAt(params.position.line, params.position.character)
      return provideHover(workspace, state, offset)
    } catch (err) {
      log(`hover CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
      return null
    }
  })

  // ─── Definition ────────────────────────────────────────────

  connection.onDefinition((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return null
    try {
      const offset = state.lineMap.offsetAt(params.position.line, params.position.character)
      return provideDefinition(workspace, state, offset)
    } catch (err) {
      log(`definition CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
      return null
    }
  })

  // ─── Completion ────────────────────────────────────────────

  connection.onCompletion((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return []
    try {
      const offset = state.lineMap.offsetAt(params.position.line, params.position.character)
      return provideCompletion(workspace, state, offset)
    } catch (err) {
      log(`completion CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
      return []
    }
  })

  // ─── Document Symbols ──────────────────────────────────────

  connection.onDocumentSymbol((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return []
    try {
      return provideDocumentSymbols(state)
    } catch (err) {
      log(`symbols CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
      return []
    }
  })

  // ─── Semantic Tokens ───────────────────────────────────────

  connection.languages.semanticTokens.on((params) => {
    const state = workspace.get(params.textDocument.uri)
    if (!state) return { data: [] }
    try {
      const t0 = performance.now()
      const data = provideSemanticTokens(state)
      const ms = (performance.now() - t0).toFixed(1)
      log(`semanticTokens → ${data.length / 5} tokens (${ms}ms)`)
      return { data }
    } catch (err) {
      log(`semanticTokens CRASHED: ${err instanceof Error ? err.stack : String(err)}`)
      return { data: [] }
    }
  })

  // ─── Catch-all error ───────────────────────────────────────

  process.on('uncaughtException', (err) => {
    log(`UNCAUGHT EXCEPTION: ${err.stack || err.message}`)
  })

  process.on('unhandledRejection', (reason) => {
    log(`UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}`)
  })

  // ─── Start ─────────────────────────────────────────────────

  log('Calling connection.listen()')
  connection.listen()
}
