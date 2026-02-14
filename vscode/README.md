# Kernel Schema Language

Language support for `.krl` schema files — the Kernel graph DDL.

## Features

- **Syntax highlighting** — keywords, types, modifiers, operators, strings, comments
- **Diagnostics** — real-time errors and warnings as you type
- **Hover** — full type signatures with constraints and attributes
- **Go-to-definition** — jump to any type, class, interface, or edge declaration
- **Completions** — context-aware suggestions for types, modifiers, keywords, and default values
- **Document outline** — structured view of all declarations with nested attributes
- **Semantic tokens** — rich token classification for precise highlighting

## Quick Start

1. Create a `.krl` file
2. Start typing — you'll get instant feedback

```krl
extend "https://kernel.astrale.ai/v1" { Identity }

type Email = String [format: email]

interface Timestamped {
  created_at: Timestamp [readonly] = now(),
  updated_at: Timestamp?
}

class User: Identity, Timestamped {
  name: String,
  email: Email [unique]
}

class follows(follower: User, followee: User) [no_self, unique]
```

## CLI

Install the compiler for command-line usage:

```bash
npm install -g @astrale/kernel-compiler
krl compile schema.krl       # Compile to IR JSON
krl check schema.krl         # Type-check only
krl init                     # Scaffold a new project
```
