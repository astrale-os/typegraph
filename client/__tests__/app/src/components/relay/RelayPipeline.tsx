import { KeyRound, Play, Trash2, Code, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { useState } from 'react'

import { ExprCodeEditor } from '@/components/editor/ExprCodeEditor'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { evaluateExprCode, EXAMPLE_CODE, EXAMPLE_EXPR, type EvalResult } from '@/lib/expr-evaluator'
import { useGraphStore } from '@/store/graph-store'
import { useQueryStore } from '@/store/query-store'
import { useRelayStore } from '@/store/relay-store'

import { FlowTimeline } from './FlowTimeline'

const PERMS = ['read', 'edit', 'use', 'share']

export function RelayPipeline() {
  const {
    steps,
    setupDone,
    loading,
    error,
    setup,
    issueToken,
    relayToken,
    authenticate,
    kernelCheckAccess,
    clearSteps,
  } = useRelayStore()

  const nodes = useGraphStore((s) => s.nodes)
  const identities = nodes.filter((n) => n.type === 'Identity')
  const resources = nodes.filter((n) => n.type !== 'Identity' && n.type !== 'Type')

  // Expression code state
  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState(EXAMPLE_CODE)
  const [codeResult, setCodeResult] = useState<EvalResult | null>(null)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Issue token state
  const [tokenType, setTokenType] = useState<'app' | 'user'>('app')
  const [tokenId, setTokenId] = useState('')

  // Kernel query state
  const [queryNodeId, setQueryNodeId] = useState('')
  const [queryPerm, setQueryPerm] = useState('read')
  const [queryMode, setQueryMode] = useState<'check' | 'explain'>('check')

  // Query store integration
  const { setForTypeExpr, setForResourceExpr, setUseTypePrincipal, setUseResourcePrincipal } =
    useQueryStore()

  // Find latest tokens for relay/authenticate
  const tokenSteps = steps.filter((s) => s.token)
  const lastToken = tokenSteps[tokenSteps.length - 1]?.token

  const handleSetup = () => {
    const ids = identities.map((n) => n.id)
    setup(ids.length > 0 ? ids : undefined)
  }

  const handleIssueToken = () => {
    if (!tokenId) return
    issueToken(tokenType, tokenId)
  }

  const handleRelayWithLastTokens = () => {
    const appStep = steps.find((s) => s.action.includes('app'))
    const userStep = steps.find((s) => s.action.includes('user'))

    if (!appStep?.token && !userStep?.token) return

    const tokens: unknown[] = []
    if (appStep?.token) tokens.push({ jwt: appStep.token })
    if (userStep?.token) tokens.push({ jwt: userStep.token })

    const expression =
      tokens.length === 1 ? tokens[0] : { kind: 'union', left: tokens[0], right: tokens[1] }

    relayToken(expression)
  }

  const handleAuthenticate = () => {
    if (!lastToken) return
    authenticate(lastToken)
  }

  const handleKernelQuery = () => {
    if (!lastToken || !queryNodeId || !queryPerm) return
    kernelCheckAccess(lastToken, queryNodeId, queryPerm, queryMode)
  }

  // Expression code handlers
  const handleEvaluate = () => {
    setCodeError(null)
    setCodeResult(null)
    try {
      const evalResult = evaluateExprCode(code)
      setCodeResult(evalResult)
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUseInQuery = () => {
    if (!codeResult) return
    if (codeResult.type === 'grant' && codeResult.grant) {
      setForTypeExpr(codeResult.grant.forType)
      setForResourceExpr(codeResult.grant.forResource)
      setUseTypePrincipal(false)
      setUseResourcePrincipal(false)
    } else if (codeResult.type === 'expr' && codeResult.expr) {
      setForResourceExpr(codeResult.expr)
      setUseResourcePrincipal(false)
    }
  }

  const handleCopyResult = async () => {
    if (!codeResult) return
    const json = JSON.stringify(
      codeResult.type === 'grant' ? codeResult.grant : codeResult.expr,
      null,
      2,
    )
    await navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
          <KeyRound className="w-3.5 h-3.5" />
          Relay Pipeline
        </div>
        {steps.length > 0 && (
          <button
            onClick={clearSteps}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      {/* Expression Code (collapsible) */}
      <div className="border border-slate-700 rounded">
        <button
          onClick={() => setCodeOpen(!codeOpen)}
          className="flex items-center gap-2 w-full px-3 py-2 text-left"
        >
          {codeOpen ? (
            <ChevronDown className="w-3 h-3 text-slate-400" />
          ) : (
            <ChevronRight className="w-3 h-3 text-slate-400" />
          )}
          <Code className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] text-slate-300">Expression Code</span>
        </button>

        {codeOpen && (
          <div className="px-3 pb-3 space-y-2">
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
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] px-3 py-1 rounded"
              >
                <Play className="w-3 h-3" />
                Evaluate
              </button>
              <span className="text-[10px] text-slate-600 self-center">Ctrl+Enter</span>
            </div>

            <ErrorDisplay error={codeError} />

            {codeResult && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    Result: {codeResult.type === 'grant' ? 'Grant' : 'IdentityExpr'}
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
                      Use in Access
                    </button>
                  </div>
                </div>

                <pre className="text-[10px] text-slate-300 bg-slate-900 rounded p-2 overflow-auto max-h-32 font-mono">
                  {JSON.stringify(
                    codeResult.type === 'grant' ? codeResult.grant : codeResult.expr,
                    null,
                    2,
                  )}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Step 1: Setup */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-slate-400">1. Initialize KernelService</div>
        <button
          onClick={handleSetup}
          disabled={loading}
          className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-[10px] px-3 py-1.5 rounded w-full justify-center"
        >
          <Play className="w-3 h-3" />
          {setupDone ? 'Re-initialize' : 'Setup'}
        </button>
      </div>

      {/* Step 2: Issue Tokens */}
      {setupDone && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-400">2. Issue JWT</div>
          <div className="flex gap-1">
            <select
              value={tokenType}
              onChange={(e) => setTokenType(e.target.value as 'app' | 'user')}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200 w-20"
            >
              <option value="app">App</option>
              <option value="user">User</option>
            </select>
            <select
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
              className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200 flex-1"
            >
              <option value="">Select identity...</option>
              {identities.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}
                </option>
              ))}
            </select>
            <button
              onClick={handleIssueToken}
              disabled={!tokenId || loading}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[10px] px-3 py-1 rounded"
            >
              Issue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Relay Token */}
      {tokenSteps.length >= 1 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-400">
            3. Relay Token (build expression from JWTs)
          </div>
          <button
            onClick={handleRelayWithLastTokens}
            disabled={loading}
            className="flex items-center gap-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[10px] px-3 py-1.5 rounded w-full justify-center"
          >
            <Play className="w-3 h-3" />
            Relay Token
          </button>
        </div>
      )}

      {/* Step 4: Authenticate */}
      {lastToken && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-400">4. Authenticate latest token</div>
          <button
            onClick={handleAuthenticate}
            disabled={loading}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] px-3 py-1.5 rounded w-full justify-center"
          >
            <Play className="w-3 h-3" />
            Authenticate
          </button>
        </div>
      )}

      {/* Step 5: Kernel Query */}
      {lastToken && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-slate-400">
            5. Kernel Access Query (authenticate + check)
          </div>
          <div className="space-y-1">
            <select
              value={queryNodeId}
              onChange={(e) => setQueryNodeId(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200"
            >
              <option value="">Select target resource...</option>
              {resources.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id} ({n.type})
                </option>
              ))}
            </select>
            <div className="flex gap-1">
              <select
                value={queryPerm}
                onChange={(e) => setQueryPerm(e.target.value)}
                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200 flex-1"
              >
                {PERMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                value={queryMode}
                onChange={(e) => setQueryMode(e.target.value as 'check' | 'explain')}
                className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200 w-24"
              >
                <option value="check">check</option>
                <option value="explain">explain</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleKernelQuery}
            disabled={!queryNodeId || loading}
            className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[10px] px-3 py-1.5 rounded w-full justify-center"
          >
            <Play className="w-3 h-3" />
            Query via Kernel
          </button>
        </div>
      )}

      <ErrorDisplay error={error} />

      {/* Flow Timeline */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-[10px] text-slate-500 mb-2">Flow History</div>
        <FlowTimeline steps={steps} />
      </div>
    </div>
  )
}
