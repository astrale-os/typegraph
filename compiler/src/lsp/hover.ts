// src/lsp/hover.ts
// ============================================================
// Hover Provider — Rich type signatures on hover
// ============================================================

import { type Hover, MarkupKind } from 'vscode-languageserver-types'
import { type Workspace, type DocumentState } from './workspace'
import {
  type TypeAliasDecl,
  type ValueTypeDecl,
  type TaggedUnionDecl,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type DataDecl,
  type Attribute,
  type Method,
  type Projection,
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type EdgeRefType,
  type Modifier,
  type FlagModifier,
  type FormatModifier,
  type InModifier,
  type LengthModifier,
  type IndexedModifier,
  type CardinalityModifier,
  type LifecycleModifier,
  type RangeModifier,
  type MatchModifier,
  type Name,
} from '../ast/index'
import { type Symbol } from '../resolver/index'

export function provideHover(
  workspace: Workspace,
  state: DocumentState,
  offset: number,
): Hover | null {
  const symbol = workspace.symbolAt(state, offset)
  if (!symbol) return null

  const content = renderSymbol(symbol)
  if (!content) return null

  const token = workspace.tokenAt(state, offset)
  if (!token) return null

  const start = state.lineMap.positionAt(token.span.start)
  const end = state.lineMap.positionAt(token.span.end)

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: content,
    },
    range: {
      start: { line: start.line, character: start.col },
      end: { line: end.line, character: end.col },
    },
  }
}

// ─── Symbol Rendering ────────────────────────────────────────

function renderSymbol(sym: Symbol): string | null {
  // Builtin scalar
  if (sym.symbolKind === 'Scalar') {
    return `\`\`\`gsl\nscalar ${sym.name}\n\`\`\`\n\nBuiltin scalar type.`
  }

  const decl = sym.declaration
  if (!decl) {
    // Extension import stub
    return `\`\`\`gsl\n${sym.symbolKind.toLowerCase()} ${sym.name}\n\`\`\`\n\n*Imported via extension*`
  }

  switch (decl.kind) {
    case 'TypeAliasDecl':
      return renderTypeAlias(decl)
    case 'ValueTypeDecl':
      return renderValueType(decl)
    case 'InterfaceDecl':
      return renderInterface(decl)
    case 'NodeDecl':
      return renderClass(decl)
    case 'EdgeDecl':
      return renderEdge(decl)
    case 'DataDecl':
      return renderDataDecl(decl)
    case 'TaggedUnionDecl':
      return renderTaggedUnion(decl)
    default:
      return null
  }
}

function renderTypeAlias(decl: TypeAliasDecl): string {
  const mods =
    decl.modifiers.length > 0 ? ` [${decl.modifiers.map(renderModifier).join(', ')}]` : ''
  const sig = `type ${decl.name.value} = ${renderTypeExpr(decl.type)}${mods}`
  return `\`\`\`gsl\n${sig}\n\`\`\``
}

function renderValueType(decl: ValueTypeDecl): string {
  if (decl.fields.length === 0) {
    return '```gsl\ntype ' + decl.name.value + ' = {}\n```'
  }
  const fields = decl.fields.map((f) => {
    const type = renderTypeExpr(f.type)
    const list = f.list ? '[]' : ''
    const nullable = f.nullable ? '?' : ''
    const def = f.defaultValue ? ' = ...' : ''
    return `  ${f.name.value}: ${type}${list}${nullable}${def}`
  })
  return `\`\`\`gsl\ntype ${decl.name.value} = {\n${fields.join('\n')}\n}\n\`\`\``
}

function renderInterface(decl: InterfaceDecl): string {
  const ext = decl.extends.length > 0 ? `: ${decl.extends.map((e) => e.value).join(', ')}` : ''
  const body = renderBody(decl.attributes, decl.methods, decl.dataDecl, decl.dataRef)
  return `\`\`\`gsl\ninterface ${decl.name.value}${ext}${body}\n\`\`\``
}

function renderClass(decl: NodeDecl): string {
  const impl =
    decl.implements.length > 0 ? `: ${decl.implements.map((i) => i.value).join(', ')}` : ''
  const body = renderBody(decl.attributes, decl.methods, decl.dataDecl, decl.dataRef)
  return `\`\`\`gsl\nclass ${decl.name.value}${impl}${body}\n\`\`\``
}

function renderEdge(decl: EdgeDecl): string {
  const params = decl.params.map((p) => `${p.name.value}: ${renderTypeExpr(p.type)}`).join(', ')
  const impl =
    decl.implements.length > 0 ? `: ${decl.implements.map((i) => i.value).join(', ')}` : ''
  const mods =
    decl.modifiers.length > 0 ? ` [${decl.modifiers.map(renderModifier).join(', ')}]` : ''
  const body = renderBody(decl.attributes, decl.methods, decl.dataDecl, decl.dataRef)
  return `\`\`\`gsl\nclass ${decl.name.value}(${params})${impl}${mods}${body}\n\`\`\``
}

function renderDataDecl(decl: DataDecl): string {
  if (decl.scalarType) {
    return `\`\`\`gsl\ndata ${decl.name.value} = ${renderTypeExpr(decl.scalarType)}\n\`\`\``
  }
  if (decl.fields && decl.fields.length > 0) {
    const fields = decl.fields.map((f) => {
      const type = renderTypeExpr(f.type)
      const list = f.list ? '[]' : ''
      const nullable = f.nullable ? '?' : ''
      return `  ${f.name.value}: ${type}${list}${nullable}`
    })
    return `\`\`\`gsl\ndata ${decl.name.value} = {\n${fields.join('\n')}\n}\n\`\`\``
  }
  return `\`\`\`gsl\ndata ${decl.name.value} = {}\n\`\`\``
}

function renderTaggedUnion(decl: TaggedUnionDecl): string {
  const variants = decl.variants.map((v) => {
    if (v.fields.length === 0) return `| ${v.tag}`
    const fields = v.fields.map((f) => `${f.name.value}: ${renderTypeExpr(f.type)}`)
    return `| ${v.tag} { ${fields.join(', ')} }`
  })
  return `\`\`\`gsl\ntype ${decl.name.value} = ${variants.join(' ')}\n\`\`\``
}

function renderAttribute(attr: Attribute): string {
  const mods =
    attr.modifiers.length > 0 ? ` [${attr.modifiers.map(renderModifier).join(', ')}]` : ''
  const def = attr.defaultValue ? ` = ...` : ''
  return `${attr.name.value}: ${renderTypeExpr(attr.type)}${mods}${def}`
}

function renderMethod(m: Method): string {
  const params = m.params.map((p) => `${p.name.value}: ${renderTypeExpr(p.type)}`).join(', ')
  const ret = renderTypeExpr(m.returnType)
  const proj = renderProjection(m.projection)
  const suffix = m.returnList ? '[]' : m.returnNullable ? '?' : ''
  return `fn ${m.name.value}(${params}): ${ret}${proj}${suffix}`
}

function renderProjection(proj: Projection | null): string {
  if (!proj) return ''
  const items: string[] = []
  if (proj.star) items.push('*')
  for (const f of proj.fields) items.push(f.value)
  if (proj.dataRef) items.push(proj.dataRef.value)
  if (items.length === 0) return ''
  return ` { ${items.join(', ')} }`
}

function renderBody(
  attributes: Attribute[],
  methods: Method[],
  dataDecl?: DataDecl | null,
  dataRef?: Name | null,
): string {
  const lines: string[] = [...attributes.map(renderAttribute), ...methods.map(renderMethod)]
  if (dataDecl) {
    lines.push(`data ${dataDecl.name.value}`)
  } else if (dataRef) {
    lines.push(`data ${dataRef.value}`)
  }
  return lines.length > 0 ? ` {\n  ${lines.join('\n  ')}\n}` : ' {}'
}

function renderTypeExpr(expr: TypeExpr): string {
  switch (expr.kind) {
    case 'NamedType':
      return (expr as NamedType).name.value
    case 'NullableType':
      return `${renderTypeExpr((expr as NullableType).inner)}?`
    case 'UnionType':
      return (expr as UnionType).types.map(renderTypeExpr).join(' | ')
    case 'EdgeRefType': {
      const target = (expr as EdgeRefType).target
      return target ? `edge<${target.value}>` : 'edge<any>'
    }
    default:
      return '?'
  }
}

function renderModifier(mod: Modifier): string {
  switch (mod.kind) {
    case 'FlagModifier':
      return (mod as FlagModifier).flag
    case 'FormatModifier':
      return `format: ${(mod as FormatModifier).format}`
    case 'MatchModifier':
      return `match: "${(mod as MatchModifier).pattern}"`
    case 'InModifier':
      return `in: [${(mod as InModifier).values.map((v) => `"${v}"`).join(', ')}]`
    case 'LengthModifier':
      return `length: ${(mod as LengthModifier).min}..${(mod as LengthModifier).max}`
    case 'IndexedModifier':
      return `indexed: ${(mod as IndexedModifier).direction}`
    case 'CardinalityModifier': {
      const cm = mod as CardinalityModifier
      const bound =
        cm.max === null ? `${cm.min}..*` : cm.min === cm.max ? `${cm.min}` : `${cm.min}..${cm.max}`
      return `${cm.param.value} -> ${bound}`
    }
    case 'RangeModifier': {
      const rm = mod as RangeModifier
      if (rm.operator === '>=') return `>= ${rm.min}`
      if (rm.operator === '<=') return `<= ${rm.max}`
      return `${rm.min}..${rm.max}`
    }
    case 'LifecycleModifier': {
      const lm = mod as LifecycleModifier
      return `${lm.event}: ${lm.action}`
    }
    default:
      return '?'
  }
}
