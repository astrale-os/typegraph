import type { IdentityExpr } from '@/types/api'

type AnyExpr = IdentityExpr &
  Partial<{
    expr: IdentityExpr
    scopes: unknown[]
    left: IdentityExpr
    right: IdentityExpr
    operands: IdentityExpr[]
    base: IdentityExpr
    excluded: IdentityExpr[]
  }>

function renderExpr(expr: IdentityExpr | undefined, depth: number = 0): string {
  if (!expr) return '<undefined>'
  const indent = '  '.repeat(depth)
  const e = expr as AnyExpr
  switch (expr.kind) {
    case 'identity':
      return `identity("${expr.id}")`
    case 'scope': {
      const inner = renderExpr(e.expr, depth)
      return `${inner} [${e.scopes?.length ?? 0} scope(s)]`
    }
    case 'union':
    case 'intersect': {
      const op = expr.kind.toUpperCase()
      // Handle both N-ary (operands) and binary (left/right) formats
      const children = e.operands ?? [e.left, e.right].filter(Boolean)
      const parts = (children as IdentityExpr[]).map((o) => renderExpr(o, depth + 1))
      return `${op}(\n${indent}  ${parts.join(`,\n${indent}  `)}\n${indent})`
    }
    case 'exclude': {
      // Handle both new (base/excluded) and old (left/right) formats
      const base = renderExpr(e.base ?? e.left, depth + 1)
      const excludedList = e.excluded ?? (e.right ? [e.right] : [])
      const excluded = (excludedList as IdentityExpr[]).map((ex) => renderExpr(ex, depth + 1))
      return `EXCLUDE(\n${indent}  ${base},\n${indent}  [${excluded.join(', ')}]\n${indent})`
    }
    default:
      return `<unknown kind: ${(expr as { kind: string }).kind}>`
  }
}

interface ExpressionPreviewProps {
  label: string
  expr: IdentityExpr | null
}

export function ExpressionPreview({ label, expr }: ExpressionPreviewProps) {
  if (!expr) {
    return <div className="text-[10px] text-slate-600">{label}: not set</div>
  }

  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <pre className="text-[10px] text-slate-300 bg-slate-800 rounded p-2 overflow-x-auto font-mono">
        {renderExpr(expr)}
      </pre>
    </div>
  )
}
