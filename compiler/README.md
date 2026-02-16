# Kernel

Graph schema compiler, CLI, and VS Code extension for `.gsl` files.

## Structure

```
kernel-compiler/     Compiler, CLI, and LSP server
kernel-vscode/       VS Code extension (LSP client + TextMate grammar)
ir-schema-v4.json    IR JSON Schema contract
kernel-lang-0.1.0.vsix  Pre-built extension (install directly)
```

## Quick Start

### Install the VS Code extension (pre-built)

```bash
code --install-extension kernel-lang-0.1.0.vsix
```

### Or build from source

```bash
# 1. Install compiler dependencies
cd kernel-compiler
npm install

# 2. Run tests
npm test

# 3. Install extension dependencies
cd ../kernel-vscode
npm install

# 4. Build everything (bundles LSP server + extension client)
npm run build

# 5. Package .vsix
npm run package

# 6. Install
code --install-extension kernel-lang-0.1.0.vsix
```

### CLI

```bash
cd compiler
npm install
npx tsx src/cli.ts compile path/to/schema.gsl
npx tsx src/cli.ts check path/to/schema.gsl
npx tsx src/cli.ts init my-project
```

## Extension Features

- **Diagnostics** — real-time errors and warnings as you type
- **Hover** — full type signatures with constraints
- **Go-to-definition** — jump to any declaration
- **Completions** — context-aware (types after `:`, modifiers inside `[]`, keywords at top-level)
- **Document outline** — structured symbol tree
- **Semantic tokens** — rich highlighting beyond TextMate
- **Syntax highlighting** — TextMate grammar for immediate color

## Tests

```bash
cd compiler
npm install
npm test          # 186 tests across 6 suites
```
