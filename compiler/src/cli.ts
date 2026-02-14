#!/usr/bin/env node
// src/cli.ts
// ============================================================
// CLI — krl compile | check | init
//
// Rich diagnostic output with source snippets, colors, and
// precise underlines.
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, basename, dirname } from 'path'
import { compile } from './compile'
import { type DiagnosticBag, Diagnostic } from './diagnostics'
import { LineMap } from './linemap'
import { createHash } from 'crypto'
import { KERNEL_PRELUDE } from './kernel-prelude'
import { DEFAULT_PRELUDE, type Prelude } from './prelude'

// ─── Colors (ANSI, no deps) ─────────────────────────────────

const USE_COLOR = process.stdout.isTTY !== false && !process.env.NO_COLOR

const c = {
  reset: USE_COLOR ? '\x1b[0m' : '',
  bold: USE_COLOR ? '\x1b[1m' : '',
  dim: USE_COLOR ? '\x1b[2m' : '',
  red: USE_COLOR ? '\x1b[31m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  blue: USE_COLOR ? '\x1b[34m' : '',
  cyan: USE_COLOR ? '\x1b[36m' : '',
  green: USE_COLOR ? '\x1b[32m' : '',
  magenta: USE_COLOR ? '\x1b[35m' : '',
}

// ─── Diagnostic Rendering ────────────────────────────────────

function renderDiagnostics(source: string, diagnostics: DiagnosticBag, filePath: string): string {
  const lines: string[] = []
  const lineMap = new LineMap(source)
  const all = [...diagnostics.getErrors(), ...diagnostics.getWarnings()]

  // Sort by offset
  all.sort((a, b) => a.span.start - b.span.start)

  for (const diag of all) {
    const pos = lineMap.positionAt(diag.span.start)
    const endPos = lineMap.positionAt(diag.span.end)

    // Severity color
    const sevColor = diag.severity === 'error' ? c.red : c.yellow
    const sevLabel = diag.severity === 'error' ? 'error' : 'warning'

    // Header: file:line:col: error[E001]: message
    lines.push(
      `${c.bold}${filePath}:${pos.line + 1}:${pos.col + 1}:${c.reset} ` +
        `${sevColor}${c.bold}${sevLabel}[${diag.code}]${c.reset}: ${diag.message}`,
    )

    // Source line
    const sourceLine = lineMap.lineText(pos.line)
    const lineNum = String(pos.line + 1)
    const gutter = `${c.blue}${lineNum.padStart(4)} │${c.reset} `

    lines.push(gutter + sourceLine)

    // Underline
    const underlineStart = pos.col
    const underlineLen =
      pos.line === endPos.line
        ? Math.max(1, endPos.col - pos.col)
        : Math.max(1, sourceLine.length - pos.col)

    const pad = ' '.repeat(4 + 3 + underlineStart) // gutter width
    lines.push(`${pad}${sevColor}${'^'.repeat(underlineLen)}${c.reset}`)

    lines.push('') // blank separator
  }

  return lines.join('\n')
}

function renderSummary(diagnostics: DiagnosticBag): string {
  const errors = diagnostics.getErrors().length
  const warnings = diagnostics.getWarnings().length
  const parts: string[] = []

  if (errors > 0) {
    parts.push(`${c.red}${c.bold}${errors} error${errors !== 1 ? 's' : ''}${c.reset}`)
  }
  if (warnings > 0) {
    parts.push(`${c.yellow}${c.bold}${warnings} warning${warnings !== 1 ? 's' : ''}${c.reset}`)
  }
  if (parts.length === 0) {
    return `${c.green}${c.bold}✓ No issues${c.reset}`
  }
  return parts.join(', ')
}

// ─── Commands ────────────────────────────────────────────────

function cmdCompile(inputPath: string, outputPath?: string, prelude?: Prelude): number {
  const absInput = resolve(inputPath)
  if (!existsSync(absInput)) {
    process.stderr.write(`${c.red}${c.bold}error${c.reset}: file not found: ${absInput}\n`)
    return 1
  }

  const source = readFileSync(absInput, 'utf-8')
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)

  const { ir, diagnostics } = compile(source, { sourceHash: hash, prelude })

  if (diagnostics.getErrors().length > 0 || diagnostics.getWarnings().length > 0) {
    process.stderr.write(renderDiagnostics(source, diagnostics, inputPath) + '\n')
  }

  process.stderr.write(renderSummary(diagnostics) + '\n')

  if (!ir) {
    return 1
  }

  const json = JSON.stringify(ir, null, 2)
  const out = outputPath ?? inputPath.replace(/\.krl$/, '.ir.json')

  writeFileSync(out, json + '\n', 'utf-8')
  process.stderr.write(`${c.dim}→ ${out}${c.reset}\n`)
  return 0
}

function cmdCheck(inputPath: string, prelude?: Prelude): number {
  const absInput = resolve(inputPath)
  if (!existsSync(absInput)) {
    process.stderr.write(`${c.red}${c.bold}error${c.reset}: file not found: ${absInput}\n`)
    return 1
  }

  const source = readFileSync(absInput, 'utf-8')
  const { diagnostics } = compile(source, { prelude })

  if (diagnostics.getErrors().length > 0 || diagnostics.getWarnings().length > 0) {
    process.stderr.write(renderDiagnostics(source, diagnostics, inputPath) + '\n')
  }

  process.stderr.write(renderSummary(diagnostics) + '\n')
  return diagnostics.hasErrors() ? 1 : 0
}

function cmdInit(dir?: string): number {
  const target = resolve(dir ?? '.')
  const schemaPath = resolve(target, 'schema.krl')
  const configPath = resolve(target, 'krl.json')

  if (existsSync(schemaPath)) {
    process.stderr.write(`${c.yellow}schema.krl already exists, skipping${c.reset}\n`)
    return 0
  }

  mkdirSync(target, { recursive: true })

  writeFileSync(
    schemaPath,
    `-- Schema definition
-- See: https://kernel.astrale.ai/docs

extend "https://kernel.astrale.ai/v1" { Identity }

interface Timestamped {
  created_at: Timestamp [readonly] = now(),
  updated_at: Timestamp?
}

class User: Identity, Timestamped {
  name: String,
  email: String [unique]
}
`,
    'utf-8',
  )

  writeFileSync(
    configPath,
    JSON.stringify(
      {
        schema: 'schema.krl',
        output: 'schema.ir.json',
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  )

  process.stderr.write(`${c.green}${c.bold}✓${c.reset} Created ${schemaPath}\n`)
  process.stderr.write(`${c.green}${c.bold}✓${c.reset} Created ${configPath}\n`)
  return 0
}

// ─── Argument Parsing (minimal, no deps) ─────────────────────

function printUsage(): void {
  const prog = 'krl'
  process.stderr.write(`
${c.bold}${prog}${c.reset} — KRL schema compiler

${c.bold}USAGE${c.reset}
  ${prog} compile <file.krl> [-o output.json]    Compile schema to IR
  ${prog} check <file.krl>                       Type-check without emitting
  ${prog} init [dir]                             Scaffold a new schema project
  ${prog} lsp                                    Start language server (stdio)

${c.bold}OPTIONS${c.reset}
  -o, --output <path>    Output file path (default: <input>.ir.json)
  --no-prelude           Compile without the kernel prelude
  -h, --help             Show this help
  --no-color             Disable colors

${c.bold}EXAMPLES${c.reset}
  ${prog} compile schema.krl
  ${prog} compile schema.krl --no-prelude
  ${prog} check schema.krl
  ${prog} init my-project
`)
}

function main(): number {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    printUsage()
    return args.includes('-h') || args.includes('--help') ? 0 : 1
  }

  const command = args[0]
  const noPrelude = args.includes('--no-prelude')
  const prelude = noPrelude ? DEFAULT_PRELUDE : KERNEL_PRELUDE

  switch (command) {
    case 'compile': {
      const file = args[1]
      if (!file) {
        process.stderr.write(`${c.red}error${c.reset}: missing input file\n`)
        return 1
      }
      const outIdx = args.indexOf('-o')
      const outIdx2 = args.indexOf('--output')
      const outFlagIdx = outIdx >= 0 ? outIdx : outIdx2
      const output = outFlagIdx >= 0 ? args[outFlagIdx + 1] : undefined
      return cmdCompile(file, output, prelude)
    }

    case 'check': {
      const file = args[1]
      if (!file) {
        process.stderr.write(`${c.red}error${c.reset}: missing input file\n`)
        return 1
      }
      return cmdCheck(file, prelude)
    }

    case 'init': {
      return cmdInit(args[1])
    }

    case 'lsp': {
      import('./lsp/server.js').then((mod) => mod.startServer(prelude))
      return 0
    }

    default:
      process.stderr.write(`${c.red}error${c.reset}: unknown command '${command}'\n`)
      printUsage()
      return 1
  }
}

const exitCode = main()
if (exitCode !== 0 && process.argv[2] !== 'lsp') {
  process.exit(exitCode)
}
