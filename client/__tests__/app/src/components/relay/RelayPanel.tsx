import { useState } from 'react'
import { KeyRound, Play, Trash2 } from 'lucide-react'
import { useRelayStore } from '@/store/relay-store'
import { useGraphStore } from '@/store/graph-store'
import { FlowTimeline } from './FlowTimeline'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'

export function RelayPanel() {
  const {
    steps,
    setupDone,
    loading,
    error,
    setup,
    issueToken,
    relayToken,
    authenticate,
    clearSteps,
  } = useRelayStore()

  const nodes = useGraphStore((s) => s.nodes)
  const identities = nodes.filter((n) => n.type === 'Identity')

  const [tokenType, setTokenType] = useState<'app' | 'user'>('app')
  const [tokenId, setTokenId] = useState('')

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
    // Build expression from the last two tokens (app + user JWTs)
    const appStep = steps.find((s) => s.action.includes('app'))
    const userStep = steps.find((s) => s.action.includes('user'))

    if (!appStep?.token && !userStep?.token) return

    // Build a union expression using both tokens
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

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
          <KeyRound className="w-3.5 h-3.5" />
          Relay Token Flow
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

      <ErrorDisplay error={error} />

      {/* Flow Timeline */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-[10px] text-slate-500 mb-2">Flow History</div>
        <FlowTimeline steps={steps} />
      </div>
    </div>
  )
}
