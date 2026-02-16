# Kernel Schema Language

Language support for `.gsl` schema files — the Kernel graph DDL.

## Features

- **Syntax highlighting** — keywords, types, modifiers, operators, strings, comments
- **Diagnostics** — real-time errors and warnings as you type
- **Hover** — full type signatures with constraints and attributes
- **Go-to-definition** — jump to any type, class, interface, or edge declaration
- **Completions** — context-aware suggestions for types, modifiers, keywords, and default values
- **Document outline** — structured view of all declarations with nested attributes
- **Semantic tokens** — rich token classification for precise highlighting

## Quick Start

1. Create a `.gsl` file
2. Start typing — you'll get instant feedback

```gsl
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
gsl compile schema.gsl       # Compile to IR JSON
gsl check schema.gsl         # Type-check only
gsl init                     # Scaffold a new project
```
