/**
 * Query Builder
 *
 * Execute custom Cypher queries and measure latency.
 */

import { Play, Clock, Copy, Check, ChevronDown } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

interface QueryBuilderProps {
  scale: string
  graphName: string | null
}

interface QueryResult {
  data: unknown[]
  queryTimeMs: number // Server-side query execution time
  roundTripMs: number // Full HTTP round-trip time
  error?: string
}

const DEFAULT_QUERIES: Record<string, { name: string; query: string }[]> = {
  Browse: [
    {
      name: 'List all nodes',
      query: `MATCH (n)
RETURN n.id as id, labels(n) as labels
ORDER BY labels, id`,
    },
    {
      name: 'List modules',
      query: `MATCH (n:Module)
RETURN n.id as id
ORDER BY id
LIMIT 50`,
    },
    {
      name: 'List identities',
      query: `MATCH (n:Identity)
RETURN n.id as id
ORDER BY id`,
    },
    {
      name: 'List spaces',
      query: `MATCH (n:Space)
RETURN n.id as id
ORDER BY id`,
    },
    {
      name: 'List types',
      query: `MATCH (n:Type)
RETURN n.id as id
ORDER BY id`,
    },
  ],
  Target: [
    {
      name: 'Get target type',
      query: `MATCH (n:Node {id: $nodeId})-[:ofType]->(t:Type)
RETURN n.id as node, t.id as typeId`,
    },
    {
      name: 'Get target with parent chain',
      query: `MATCH (n:Node {id: $nodeId})
MATCH path = (n)-[:hasParent*0..10]->(ancestor)
WHERE NOT (ancestor)-[:hasParent]->()
RETURN [node IN nodes(path) | node.id] as ancestorPath, length(path) as depth`,
    },
    {
      name: 'Get target info (type + space)',
      query: `MATCH (n:Node {id: $nodeId})-[:ofType]->(t:Type)
MATCH (n)-[:hasParent*]->(s:Space)
RETURN n.id as node, t.id as type, s.id as space`,
    },
  ],
  Permissions: [
    {
      name: 'Check direct permission',
      query: `MATCH (identity:Node {id: $identityId})-[p:hasPerm]->(target:Node {id: $nodeId})
WHERE $perm IN p.perms
RETURN identity.id as identity, target.id as target, p.perms as perms`,
    },
    {
      name: 'Find all permissions for identity',
      query: `MATCH (identity:Node {id: $identityId})-[p:hasPerm]->(target)
RETURN target.id as target, p.perms as perms
LIMIT 20`,
    },
    {
      name: 'Check permission with inheritance',
      query: `MATCH (identity:Node {id: $identityId})-[p:hasPerm]->(ancestor)
WHERE $perm IN p.perms
WITH identity, ancestor, p
MATCH (n:Node {id: $nodeId})
MATCH path = (n)-[:hasParent*0..10]->(ancestor)
RETURN identity.id, ancestor.id as grantedOn, length(path) as depth`,
    },
  ],
  Identity: [
    {
      name: 'Resolve composed identity (union)',
      query: `MATCH (identity:Node {id: $identityId})-[:unionWith*1..3]->(member)
RETURN identity.id as composed, collect(member.id) as members`,
    },
    {
      name: 'Resolve composed identity (exclude)',
      query: `MATCH (identity:Node {id: $identityId})-[:excludeWith]->(excluded)
RETURN identity.id as identity, excluded.id as excluded`,
    },
  ],
  'Access Check': [
    {
      name: 'Check access (full query)',
      query: `MATCH (identity:Node {id: $identityId})-[p:hasPerm]->(ancestor)
WHERE $perm IN p.perms
WITH identity, ancestor, p
MATCH (target:Node {id: $nodeId})
OPTIONAL MATCH path = (target)-[:hasParent*0..10]->(ancestor)
WHERE path IS NOT NULL
RETURN identity.id as identity,
       ancestor.id as grantedOn,
       target.id as target,
       p.perms as perms,
       CASE WHEN path IS NOT NULL THEN length(path) ELSE -1 END as depth`,
    },
    {
      name: 'Find grant path for access',
      query: `MATCH (identity:Node {id: $identityId})-[p:hasPerm]->(grantNode)
WHERE $perm IN p.perms
WITH identity, grantNode, p
MATCH (target:Node {id: $nodeId})
MATCH path = (target)-[:hasParent*0..10]->(grantNode)
RETURN identity.id, grantNode.id as grantedOn,
       [n IN nodes(path) | n.id] as path,
       length(path) as depth
LIMIT 5`,
    },
  ],
  Stats: [
    {
      name: 'Count nodes by label',
      query: `MATCH (n)
WITH labels(n) as lbls, count(*) as cnt
RETURN lbls, cnt
ORDER BY cnt DESC`,
    },
    {
      name: 'Count edges by type',
      query: `MATCH ()-[r]->()
WITH type(r) as relType, count(*) as cnt
RETURN relType, cnt
ORDER BY cnt DESC`,
    },
    {
      name: 'Graph depth distribution',
      query: `MATCH path = (leaf)-[:hasParent*]->(root:Space)
WHERE NOT (leaf)<-[:hasParent]-()
RETURN length(path) as depth, count(*) as count
ORDER BY depth`,
    },
    {
      name: 'Permission density',
      query: `MATCH (i:Identity)-[p:hasPerm]->()
RETURN i.id as identity, count(p) as permCount
ORDER BY permCount DESC
LIMIT 10`,
    },
  ],
}

export function QueryBuilder({ scale, graphName }: QueryBuilderProps) {
  const [query, setQuery] = useState(DEFAULT_QUERIES['Target'][0].query)
  const [params, setParams] = useState<Record<string, string>>({
    nodeId: scale === 'base' ? 'api' : 'M0-1',
    identityId: scale === 'base' ? 'USER-alice' : 'USER-0',
    perm: 'read',
  })
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Update default params when scale changes
  useEffect(() => {
    setParams({
      nodeId: scale === 'base' ? 'api' : 'M0-1',
      identityId: scale === 'base' ? 'USER-alice' : 'USER-0',
      perm: 'read',
    })
    setResult(null)
  }, [scale])

  const handleExecute = async () => {
    if (running || !query.trim()) return
    setRunning(true)
    setResult(null)

    try {
      // Only include params that are actually in the query
      const queryParamNames = new Set([...query.matchAll(/\$(\w+)/g)].map((m) => m[1]))

      // Parse params - convert string values to appropriate types
      const parsedParams: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(params)) {
        if (!queryParamNames.has(key)) continue // Skip params not in query
        if (value === 'true') parsedParams[key] = true
        else if (value === 'false') parsedParams[key] = false
        else if (/^\d+$/.test(value)) parsedParams[key] = parseInt(value, 10)
        else parsedParams[key] = value
      }

      const startTime = performance.now()
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, params: parsedParams }),
      })
      const endTime = performance.now()
      const roundTripMs = endTime - startTime

      if (!response.ok) {
        const error = await response.json()
        setResult({
          data: [],
          queryTimeMs: 0,
          roundTripMs,
          error: error.error || 'Query failed',
        })
      } else {
        const { results, queryTimeMs } = await response.json()
        setResult({
          data: results,
          queryTimeMs: queryTimeMs ?? roundTripMs,
          roundTripMs,
        })
      }
    } catch (err) {
      setResult({
        data: [],
        queryTimeMs: 0,
        roundTripMs: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRunning(false)
    }
  }

  const handlePresetSelect = (preset: { name: string; query: string }) => {
    setQuery(preset.query)
    setResult(null)
    setOpenDropdown(null)

    // Extract params from new query and merge with existing params
    const newParamNames = [...preset.query.matchAll(/\$(\w+)/g)].map((m) => m[1])
    const newParams: Record<string, string> = {}
    for (const name of newParamNames) {
      // Use existing value if available, otherwise use default
      newParams[name!] = params[name!] ?? getDefaultParam(name!, scale)
    }
    setParams(newParams)
  }

  const getDefaultParam = (name: string, scale: string): string => {
    switch (name) {
      case 'nodeId':
        return scale === 'base' ? 'api' : 'M0-1'
      case 'identityId':
        return scale === 'base' ? 'USER-alice' : 'USER-0'
      case 'perm':
        return 'read'
      default:
        return ''
    }
  }

  const handleCopyQuery = () => {
    navigator.clipboard.writeText(query)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleParamChange = (key: string, value: string) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  // Extract param names from query
  const paramNames = [...query.matchAll(/\$(\w+)/g)].map((m) => m[1])

  return (
    <div className="space-y-3">
      {/* Graph Info */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-slate-500">
          Graph: <span className="text-slate-300">{graphName || 'Not selected'}</span>
        </span>
        <span className="text-slate-500">
          Scale: <span className="text-slate-300">{scale}</span>
        </span>
      </div>

      {/* Preset Queries */}
      <div className="space-y-1" ref={dropdownRef}>
        <div className="text-[10px] text-slate-500">Presets:</div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(DEFAULT_QUERIES).map(([category, presets]) => (
            <div key={category} className="relative">
              <button
                onClick={() => setOpenDropdown(openDropdown === category ? null : category)}
                className="flex items-center gap-1 text-[9px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded"
              >
                {category}
                <ChevronDown
                  className={`w-2.5 h-2.5 transition-transform ${openDropdown === category ? 'rotate-180' : ''}`}
                />
              </button>
              {openDropdown === category && (
                <div className="absolute left-0 top-full mt-1 bg-slate-800 border border-slate-600 rounded shadow-lg z-20 min-w-[220px]">
                  {presets.map((preset, idx) => (
                    <button
                      key={idx}
                      onClick={() => handlePresetSelect(preset)}
                      className="block w-full text-left text-[9px] text-slate-300 hover:bg-slate-700 px-2 py-1.5 first:rounded-t last:rounded-b"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Query Editor */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-slate-500">Cypher Query:</div>
          <button
            onClick={handleCopyQuery}
            className="p-1 text-slate-500 hover:text-slate-300"
            title="Copy query"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full h-32 bg-slate-900 border border-slate-600 rounded p-2 text-[10px] text-slate-200 font-mono resize-y"
          placeholder="Enter Cypher query..."
          spellCheck={false}
        />
      </div>

      {/* Parameters */}
      {paramNames.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-slate-500">Parameters:</div>
          <div className="grid grid-cols-2 gap-2">
            {paramNames.map((name) => (
              <div key={name} className="flex items-center gap-1">
                <label className="text-[9px] text-slate-400 w-20">${name}:</label>
                <input
                  type="text"
                  value={params[name] || ''}
                  onChange={(e) => handleParamChange(name, e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200 font-mono"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execute Button */}
      <button
        onClick={handleExecute}
        disabled={running || !query.trim()}
        className="flex items-center justify-center gap-1.5 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[10px] px-3 py-2 rounded"
      >
        {running ? (
          <>
            <Clock className="w-3 h-3 animate-pulse" />
            Executing...
          </>
        ) : (
          <>
            <Play className="w-3 h-3" />
            Execute Query
          </>
        )}
      </button>

      {/* Results */}
      {result && (
        <div className="space-y-2">
          {/* Latency */}
          <div className="flex items-center gap-3 text-[10px]">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-500" />
              <span className="text-slate-400">Query:</span>
              <span
                className={`font-medium ${result.queryTimeMs < 5 ? 'text-emerald-400' : result.queryTimeMs < 20 ? 'text-amber-400' : 'text-red-400'}`}
              >
                {result.queryTimeMs.toFixed(2)}ms
              </span>
            </div>
            <div className="flex items-center gap-1 text-slate-500">
              <span>Round-trip:</span>
              <span>{result.roundTripMs.toFixed(1)}ms</span>
            </div>
            {result.data.length > 0 && (
              <span className="text-slate-500">({result.data.length} rows)</span>
            )}
          </div>

          {/* Error */}
          {result.error && (
            <div className="bg-red-900/30 border border-red-700 rounded p-2 text-[10px] text-red-400">
              {result.error}
            </div>
          )}

          {/* Data */}
          {result.data.length > 0 && (
            <div className="bg-slate-900 border border-slate-700 rounded overflow-hidden">
              <div className="max-h-48 overflow-auto">
                <table className="w-full text-[9px]">
                  <thead className="bg-slate-800 sticky top-0">
                    <tr>
                      {Object.keys(result.data[0] as object).map((key) => (
                        <th key={key} className="text-left text-slate-400 px-2 py-1 font-medium">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row, idx) => (
                      <tr key={idx} className="border-t border-slate-800 hover:bg-slate-800/50">
                        {Object.values(row as object).map((val, vidx) => (
                          <td key={vidx} className="text-slate-300 px-2 py-1 font-mono">
                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty result */}
          {!result.error && result.data.length === 0 && (
            <div className="text-[10px] text-slate-500 text-center py-2">
              Query returned no results
            </div>
          )}
        </div>
      )}
    </div>
  )
}
