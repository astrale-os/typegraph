import type { IdentityExpr } from '@/types/api'

function renderExpr(expr: IdentityExpr, depth: number = 0): string {
  const indent = '  '.repeat(depth)
  switch (expr.kind) {
    case 'identity': {
      let str = `identity("${expr.id}")`
      if (expr.scopes && expr.scopes.length > 0) {
        str += ` [${expr.scopes.length} scope(s)]`
      }
      return str
    }
    case 'union':
    case 'intersect':
    case 'exclude': {
      const op = expr.kind.toUpperCase()
      const left = renderExpr(expr.left, depth + 1)
      const right = renderExpr(expr.right, depth + 1)
      return `${op}(\n${indent}  ${left},\n${indent}  ${right}\n${indent})`
    }
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
