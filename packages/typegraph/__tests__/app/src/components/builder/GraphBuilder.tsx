import { useState } from 'react'
import { NodeCreator } from './NodeCreator'
import { EdgeCreator } from './EdgeCreator'
import { SeedDataPanel } from './SeedDataPanel'
import { CypherConsole } from './CypherConsole'

const sections = ['Nodes', 'Edges', 'Seed', 'Cypher'] as const

export function GraphBuilder() {
  const [section, setSection] = useState<(typeof sections)[number]>('Seed')

  return (
    <div className="p-3">
      <div className="flex gap-1 mb-3">
        {sections.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={`text-xs px-2.5 py-1 rounded ${
              section === s
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-300'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {section === 'Nodes' && <NodeCreator />}
      {section === 'Edges' && <EdgeCreator />}
      {section === 'Seed' && <SeedDataPanel />}
      {section === 'Cypher' && <CypherConsole />}
    </div>
  )
}
