import { StatusBadge } from '@/components/ui/StatusBadge'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import type { AccessDecision } from '@/types/api'

interface ResultDisplayProps {
  result: AccessDecision | null
  loading: boolean
  error: string | null
}

export function ResultDisplay({ result, loading, error }: ResultDisplayProps) {
  if (loading) {
    return <div className="text-xs text-slate-500">Checking access...</div>
  }

  if (error) {
    return <ErrorDisplay error={error} />
  }

  if (!result) return null

  return (
    <div className="bg-slate-800 rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Result:</span>
        <StatusBadge variant={result.granted ? 'granted' : 'denied'}>
          {result.granted ? 'GRANTED' : 'DENIED'}
        </StatusBadge>
      </div>
      {result.deniedBy && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Denied by:</span>
          <StatusBadge variant={result.deniedBy}>
            {result.deniedBy === 'type' ? 'Type Check' : 'Resource Check'}
          </StatusBadge>
        </div>
      )}
    </div>
  )
}
