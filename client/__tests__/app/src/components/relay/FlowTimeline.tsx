import type { FlowStep } from '@/store/relay-store'

import { TokenDisplay } from './TokenDisplay'

interface FlowTimelineProps {
  steps: FlowStep[]
}

export function FlowTimeline({ steps }: FlowTimelineProps) {
  if (steps.length === 0) {
    return (
      <div className="text-[10px] text-slate-600 text-center py-4">
        No steps yet. Start by setting up the relay service.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={step.id} className="relative">
          {/* Timeline connector */}
          {i < steps.length - 1 && (
            <div className="absolute left-3 top-6 bottom-0 w-px bg-slate-700" />
          )}

          <div className="flex gap-2">
            {/* Step number */}
            <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center text-[9px] text-slate-300 font-medium shrink-0">
              {step.id}
            </div>

            <div className="flex-1 space-y-1.5">
              {/* Step header */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-300 font-medium">{step.action}</span>
                <div className="flex items-center gap-2 text-[9px]">
                  <span className="text-emerald-400">{step.latencyMs}ms</span>
                  {step.tokenSize && <span className="text-slate-500">{step.tokenSize}B</span>}
                </div>
              </div>

              {/* Token display */}
              {((step.token !== null && step.token !== undefined) ||
                (step.decodedPayload !== null && step.decodedPayload !== undefined)) && (
                <TokenDisplay
                  label="JWT Payload"
                  token={step.token}
                  payload={step.decodedPayload}
                />
              )}

              {/* Result display */}
              {step.result !== null && step.result !== undefined && !step.decodedPayload && (
                <pre className="text-[10px] text-slate-400 font-mono bg-slate-800/50 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
                  {JSON.stringify(step.result, null, 2)}
                </pre>
              )}

              {/* Error */}
              {step.error !== null && step.error !== undefined && (
                <div className="text-[10px] text-red-400 bg-red-900/20 rounded p-1.5">
                  {step.error}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
