import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'

interface TokenDisplayProps {
  label: string
  token?: string
  payload?: unknown
}

export function TokenDisplay({ label, token, payload }: TokenDisplayProps) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!token) return
    await navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-slate-800/50 rounded p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {label}
        </button>
        {token && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
          >
            {copied ? (
              <>
                <Check className="w-2.5 h-2.5 text-green-400" />
                <span className="text-green-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-2.5 h-2.5" />
                Copy
              </>
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-1.5">
          {token && (
            <div className="text-[9px] text-slate-500 font-mono break-all bg-slate-900 rounded p-1.5 max-h-16 overflow-y-auto">
              {token}
            </div>
          )}
          {payload !== null && payload !== undefined && (
            <pre className="text-[10px] text-slate-300 font-mono bg-slate-900 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
              {JSON.stringify(payload, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
