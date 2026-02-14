import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { parseError, type ParsedError } from '@/lib/error-parser'

interface ErrorDisplayProps {
  error: string | null
}

export function ErrorDisplay({ error }: ErrorDisplayProps) {
  const [showDetails, setShowDetails] = useState(false)

  if (!error) return null

  const parsed: ParsedError = parseError(error)

  return (
    <div className="bg-red-900/30 border border-red-800 rounded p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <span className="text-xs font-medium text-red-300">{parsed.title}</span>
      </div>
      <p className="text-xs text-red-300/90">{parsed.message}</p>
      {parsed.suggestion && <p className="text-xs text-red-400/70 italic">{parsed.suggestion}</p>}
      {parsed.details && parsed.details !== parsed.message && (
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-400"
        >
          {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Details
        </button>
      )}
      {showDetails && parsed.details && (
        <pre className="text-[10px] text-red-400/60 bg-red-950/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {parsed.details}
        </pre>
      )}
    </div>
  )
}
