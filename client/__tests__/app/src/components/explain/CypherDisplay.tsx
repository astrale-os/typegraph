import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface CypherDisplayProps {
  query: string
}

const KEYWORDS =
  /\b(MATCH|WHERE|RETURN|WITH|OPTIONAL|MERGE|CREATE|DELETE|SET|REMOVE|ORDER\s+BY|LIMIT|SKIP|UNWIND|FOREACH|CASE|WHEN|THEN|ELSE|END|AND|OR|NOT|IN|AS|DISTINCT|EXISTS|NULL|TRUE|FALSE|IS)\b/gi

function highlightCypher(query: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  const re = new RegExp(KEYWORDS.source, 'gi')
  while ((match = re.exec(query)) !== null) {
    if (match.index > lastIndex) {
      parts.push(query.slice(lastIndex, match.index))
    }
    parts.push(
      <span key={match.index} className="text-blue-400 font-semibold">
        {match[0]}
      </span>,
    )
    lastIndex = re.lastIndex
  }
  if (lastIndex < query.length) {
    parts.push(query.slice(lastIndex))
  }
  return parts
}

export function CypherDisplay({ query }: CypherDisplayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(query)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] text-slate-500">Generated Cypher</div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
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
      </div>
      <pre className="text-[10px] text-emerald-300 bg-slate-900 rounded p-2.5 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap break-all border border-slate-700/50">
        {highlightCypher(query)}
      </pre>
    </div>
  )
}
