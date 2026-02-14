// src/lsp/symbols.ts
// ============================================================
// Document Symbols — Outline / Breadcrumb / Symbol Search
// ============================================================

import { type DocumentSymbol, SymbolKind, type Range } from 'vscode-languageserver-types'
import { type DocumentState } from './workspace'
import {
  type Declaration,
  type TypeAliasDecl,
  type ValueTypeDecl,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type ExtendDecl,
  type Attribute,
  type Method,
  type TypeExpr,
  NamedType,
  NullableType,
  UnionType,
  EdgeRefType,
} from '../ast/index'

export function provideDocumentSymbols(state: DocumentState): DocumentSymbol[] {
  const ast = state.result.artifacts?.ast
  if (!ast) return []

  return ast.declarations
    .map((d) => declarationToSymbol(d, state))
    .filter(Boolean) as DocumentSymbol[]
}

function declarationToSymbol(decl: Declaration, state: DocumentState): DocumentSymbol | null {
  switch (decl.kind) {
    case 'TypeAliasDecl':
      return typeAliasSymbol(decl, state)
    case 'ValueTypeDecl':
      return valueTypeSymbol(decl, state)
    case 'InterfaceDecl':
      return interfaceSymbol(decl, state)
    case 'NodeDecl':
      return classSymbol(decl, state)
    case 'EdgeDecl':
      return edgeSymbol(decl, state)
    case 'ExtendDecl':
      return extendSymbol(decl, state)
    default:
      return null
  }
}

function typeAliasSymbol(decl: TypeAliasDecl, state: DocumentState): DocumentSymbol {
  return {
    name: decl.name.value,
    detail: 'type alias',
    kind: SymbolKind.TypeParameter,
    range: spanToRange(decl.span, state),
    selectionRange: spanToRange(decl.name.span, state),
  }
}

function valueTypeSymbol(decl: ValueTypeDecl, state: DocumentState): DocumentSymbol {
  return {
    name: decl.name.value,
    detail: 'value type',
    kind: SymbolKind.Struct,
    range: spanToRange(decl.span, state),
    selectionRange: spanToRange(decl.name.span, state),
    children: decl.fields.map((f) => ({
      name: f.name.value,
      detail: renderTypeExpr(f.type) + (f.list ? '[]' : '') + (f.nullable ? '?' : ''),
      kind: SymbolKind.Field,
      range: spanToRange(f.span, state),
      selectionRange: spanToRange(f.name.span, state),
    })),
  }
}

function interfaceSymbol(decl: InterfaceDecl, state: DocumentState): DocumentSymbol {
  const ext = decl.extends.length > 0 ? `: ${decl.extends.map((e) => e.value).join(', ')}` : ''
  return {
    name: decl.name.value,
    detail: `interface${ext}`,
    kind: SymbolKind.Interface,
    range: spanToRange(decl.span, state),
    selectionRange: spanToRange(decl.name.span, state),
    children: [
      ...decl.attributes.map((a) => attributeSymbol(a, state)),
      ...decl.methods.map((m) => methodSymbol(m, state)),
    ],
  }
}

function classSymbol(decl: NodeDecl, state: DocumentState): DocumentSymbol {
  const impl =
    decl.implements.length > 0 ? `: ${decl.implements.map((i) => i.value).join(', ')}` : ''
  return {
    name: decl.name.value,
    detail: `class${impl}`,
    kind: SymbolKind.Class,
    range: spanToRange(decl.span, state),
    selectionRange: spanToRange(decl.name.span, state),
    children: [
      ...decl.attributes.map((a) => attributeSymbol(a, state)),
      ...decl.methods.map((m) => methodSymbol(m, state)),
    ],
  }
}

function edgeSymbol(decl: EdgeDecl, state: DocumentState): DocumentSymbol {
  const params = decl.params.map((p) => `${p.name.value}`).join(', ')
  return {
    name: decl.name.value,
    detail: `edge(${params})`,
    kind: SymbolKind.Event,
    range: spanToRange(decl.span, state),
    selectionRange: spanToRange(decl.name.span, state),
    children: [
      ...decl.attributes.map((a) => attributeSymbol(a, state)),
      ...decl.methods.map((m) => methodSymbol(m, state)),
    ],
  }
}

function extendSymbol(decl: ExtendDecl, state: DocumentState): DocumentSymbol {
  return {
    name: decl.uri,
    detail: `extend {${decl.imports.map((i) => i.value).join(', ')}}`,
    kind: SymbolKind.Module,
    range: spanToRange(decl.span, state),
    selectionRange: spanToRange(decl.span, state),
  }
}

function attributeSymbol(attr: Attribute, state: DocumentState): DocumentSymbol {
  return {
    name: attr.name.value,
    detail: formatTypeExpr(attr),
    kind: SymbolKind.Field,
    range: spanToRange(attr.span, state),
    selectionRange: spanToRange(attr.name.span, state),
  }
}

function methodSymbol(m: Method, state: DocumentState): DocumentSymbol {
  const params = m.params.map((p) => p.name.value).join(', ')
  const ret = renderTypeExpr(m.returnType)
  const suffix = m.returnList ? '[]' : m.returnNullable ? '?' : ''
  return {
    name: m.name.value,
    detail: `(${params}): ${ret}${suffix}`,
    kind: SymbolKind.Method,
    range: spanToRange(m.span, state),
    selectionRange: spanToRange(m.name.span, state),
  }
}

function formatTypeExpr(attr: Attribute): string {
  return renderTypeExpr(attr.type)
}

function renderTypeExpr(expr: TypeExpr): string {
  switch (expr.kind) {
    case 'NamedType':
      return expr.name.value
    case 'NullableType':
      return renderTypeExpr(expr.inner) + '?'
    case 'UnionType':
      return expr.types.map(renderTypeExpr).join(' | ')
    case 'EdgeRefType':
      return expr.target ? `edge<${expr.target.value}>` : 'edge<any>'
  }
}

function spanToRange(span: { start: number; end: number }, state: DocumentState): Range {
  const start = state.lineMap.positionAt(span.start)
  const end = state.lineMap.positionAt(span.end)
  return {
    start: { line: start.line, character: start.col },
    end: { line: end.line, character: end.col },
  }
}
