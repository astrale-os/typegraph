import { Code, Play, Copy, Check } from 'lucide-react'
import { useState } from 'react'

import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { evaluateExprCode, EXAMPLE_CODE, EXAMPLE_EXPR, type EvalResult } from '@/lib/expr-evaluator'
import { useQueryStore } from '@/store/query-store'

import { ExprCodeEditor } from './ExprCodeEditor'

export function ExprCodePanel() {
  const [code, setCode] = useState(EXAMPLE_CODE)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { setForTypeExpr, setForResourceExpr, setUseTypePrincipal, setUseResourcePrincipal } =
    useQueryStore()

  const handleEvaluate = () => {
    setError(null)
    setResult(null)
    try {
      const evalResult = evaluateExprCode(code)
      setResult(evalResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUseInQuery = () => {
    if (!result) return

    if (result.type === 'grant' && result.grant) {
      setForTypeExpr(result.grant.forType)
      setForResourceExpr(result.grant.forResource)
      setUseTypePrincipal(false)
      setUseResourcePrincipal(false)
    } else if (result.type === 'expr' && result.expr) {
      // Use as forResource by default
      setForResourceExpr(result.expr)
      setUseResourcePrincipal(false)
    }
  }

  const handleCopyResult = async () => {
    if (!result) return
    const json = JSON.stringify(result.type === 'grant' ? result.grant : result.expr, null, 2)
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
        <Code className="w-3.5 h-3.5" />
        Expression Code
      </div>

      <div className="flex gap-1">
        <button
          onClick={() => setCode(EXAMPLE_CODE)}
          className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded bg-slate-800"
        >
          Grant example
        </button>
        <button
          onClick={() => setCode(EXAMPLE_EXPR)}
          className="text-[10px] text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded bg-slate-800"
        >
          Expr example
        </button>
      </div>

      <ExprCodeEditor value={code} onChange={setCode} onEvaluate={handleEvaluate} />

      <div className="flex gap-2">
        <button
          onClick={handleEvaluate}
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-1.5 rounded"
        >
          <Play className="w-3 h-3" />
          Evaluate
        </button>
        <span className="text-[10px] text-slate-600 self-center">Ctrl+Enter</span>
      </div>

      <ErrorDisplay error={error} />

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-400">
              Result: {result.type === 'grant' ? 'Grant' : 'IdentityExpr'}
            </span>
            <div className="flex gap-1">
              <button
                onClick={handleCopyResult}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-green-400" />
                    <span className="text-green-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy
                  </>
                )}
              </button>
              <button
                onClick={handleUseInQuery}
                className="text-[10px] text-blue-400 hover:text-blue-300 px-2"
              >
                Use in Query
              </button>
            </div>
          </div>

          <pre className="text-[10px] text-slate-300 bg-slate-900 rounded p-2.5 overflow-auto max-h-48 font-mono">
            {JSON.stringify(result.type === 'grant' ? result.grant : result.expr, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
