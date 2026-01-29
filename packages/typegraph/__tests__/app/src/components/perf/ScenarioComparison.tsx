/**
 * Scenario Comparison
 *
 * Table and bar chart comparing latency across scenarios.
 */

import { useState } from 'react'
import type { ScenarioResult } from '@/types/profiling'
import { formatMicros } from '@/types/profiling'

interface ScenarioComparisonProps {
  results: ScenarioResult[]
}

type SortKey = 'name' | 'cold' | 'warm' | 'p95' | 'traces'
type SortDir = 'asc' | 'desc'

export function ScenarioComparison({ results }: ScenarioComparisonProps) {
  const [sortKey, setSortKey] = useState<SortKey>('warm')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const getCold = (r: ScenarioResult) => r.coldTrace?.totalMicros ?? 0
  const getWarm = (r: ScenarioResult) => r.warmMetrics.overall.mean

  const sortedResults = [...results].sort((a, b) => {
    let aVal: string | number
    let bVal: string | number

    switch (sortKey) {
      case 'name':
        aVal = a.scenario.name
        bVal = b.scenario.name
        break
      case 'cold':
        aVal = getCold(a)
        bVal = getCold(b)
        break
      case 'warm':
        aVal = getWarm(a)
        bVal = getWarm(b)
        break
      case 'p95':
        aVal = a.warmMetrics.overall.p95
        bVal = b.warmMetrics.overall.p95
        break
      case 'traces':
        aVal = a.traces.length
        bVal = b.traces.length
        break
    }

    if (typeof aVal === 'string') {
      return sortDir === 'asc'
        ? aVal.localeCompare(bVal as string)
        : (bVal as string).localeCompare(aVal)
    }
    return sortDir === 'asc' ? aVal - (bVal as number) : (bVal as number) - aVal
  })

  const maxWarm = Math.max(...results.map((r) => getWarm(r)), 1)

  return (
    <div className="space-y-4">
      {/* Bar Chart - shows warm (mean) with cold overlay */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-slate-400 font-medium">Latency Comparison</span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-blue-500 rounded-sm" />
            <span className="text-slate-500">Cold</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 bg-emerald-500 rounded-sm" />
            <span className="text-slate-500">Warm</span>
          </span>
        </div>
        {sortedResults.map((result) => {
          const coldMicros = getCold(result)
          const warmMicros = getWarm(result)
          const maxVal = Math.max(coldMicros, maxWarm)
          const coldWidth = (coldMicros / maxVal) * 100
          const warmWidth = (warmMicros / maxVal) * 100

          return (
            <div key={result.scenario.id} className="space-y-0.5">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-slate-300 truncate max-w-[150px]">
                  {result.scenario.name}
                </span>
                <span className="text-slate-500">
                  <span className="text-blue-400">{formatMicros(coldMicros)}</span>
                  <span className="mx-1">/</span>
                  <span className="text-emerald-400">{formatMicros(warmMicros)}</span>
                </span>
              </div>
              <div className="h-3 bg-slate-700 rounded relative overflow-hidden">
                {/* Cold bar (blue, behind) */}
                <div
                  className="absolute h-full bg-blue-500/50"
                  style={{ width: `${coldWidth}%` }}
                />
                {/* Warm bar (green, front) */}
                <div
                  className={`absolute h-full ${result.passed ? 'bg-emerald-500' : 'bg-red-500'}`}
                  style={{ width: `${warmWidth}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[9px]">
          <thead>
            <tr className="text-slate-500 border-b border-slate-700">
              <SortHeader
                label="Scenario"
                sortKey="name"
                currentKey={sortKey}
                sortDir={sortDir}
                onClick={handleSort}
              />
              <th className="py-1.5 px-2 text-left">Status</th>
              <SortHeader
                label="Cold"
                sortKey="cold"
                currentKey={sortKey}
                sortDir={sortDir}
                onClick={handleSort}
              />
              <SortHeader
                label="Warm"
                sortKey="warm"
                currentKey={sortKey}
                sortDir={sortDir}
                onClick={handleSort}
              />
              <SortHeader
                label="P95"
                sortKey="p95"
                currentKey={sortKey}
                sortDir={sortDir}
                onClick={handleSort}
              />
              <SortHeader
                label="Traces"
                sortKey="traces"
                currentKey={sortKey}
                sortDir={sortDir}
                onClick={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {sortedResults.map((result) => (
              <tr
                key={result.scenario.id}
                className="border-b border-slate-700/50 hover:bg-slate-700/30"
              >
                <td className="py-1.5 pr-2">
                  <div className="text-slate-200">{result.scenario.name}</div>
                  <div className="text-slate-500 truncate max-w-[180px]">
                    {result.scenario.description}
                  </div>
                </td>
                <td className="py-1.5 px-2">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[8px] font-medium ${
                      result.passed && result.passedThresholds
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {result.passed && result.passedThresholds ? 'PASS' : 'FAIL'}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-blue-400 font-mono">
                  {formatMicros(getCold(result))}
                </td>
                <td className="py-1.5 px-2 text-emerald-400 font-mono">
                  {formatMicros(getWarm(result))}
                </td>
                <td className="py-1.5 px-2 text-amber-400 font-mono">
                  {formatMicros(result.warmMetrics.overall.p95)}
                </td>
                <td className="py-1.5 px-2 text-slate-500">{result.traces.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-[9px] text-slate-500 border-t border-slate-700 pt-2">
        <span>Total: {results.length} scenarios</span>
        <span className="text-emerald-400">
          Passed: {results.filter((r) => r.passed && r.passedThresholds).length}
        </span>
        <span className="text-red-400">
          Failed: {results.filter((r) => !r.passed || !r.passedThresholds).length}
        </span>
      </div>
    </div>
  )
}

interface SortHeaderProps {
  label: string
  sortKey: SortKey
  currentKey: SortKey | ''
  sortDir: SortDir
  onClick: (key: SortKey) => void
}

function SortHeader({ label, sortKey, currentKey, sortDir, onClick }: SortHeaderProps) {
  const isActive = sortKey === currentKey
  return (
    <th
      className={`py-1.5 px-2 text-left cursor-pointer hover:text-slate-300 ${
        isActive ? 'text-slate-300' : ''
      }`}
      onClick={() => onClick(sortKey)}
    >
      {label}
      {isActive && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  )
}
