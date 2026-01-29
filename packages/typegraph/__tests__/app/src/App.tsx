import { useState, useEffect } from 'react'
import { ConnectionStatus } from '@/components/connection/ConnectionStatus'
import { GraphSelector } from '@/components/connection/GraphSelector'
import { Tabs } from '@/components/ui/Tabs'
import { GraphBuilder } from '@/components/builder/GraphBuilder'
import { AccessPanel } from '@/components/query/AccessPanel'
import { RelayPipeline } from '@/components/relay/RelayPipeline'
import { PerfPanel } from '@/components/perf/PerfPanel'
import { AuthzGraph } from '@/components/graph/AuthzGraph'
import { ProfilingBar } from '@/components/profiling/ProfilingBar'
import { useConnectionStore } from '@/store/connection-store'
import { useGraphStore } from '@/store/graph-store'

const SIDEBAR_TABS = ['Builder', 'Access', 'Relay', 'Perf']

export function App() {
  const [activeTab, setActiveTab] = useState('Builder')
  const autoInit = useConnectionStore((s) => s.autoInit)
  const status = useConnectionStore((s) => s.status)
  const graphName = useConnectionStore((s) => s.graphName)
  const loadFromDB = useGraphStore((s) => s.loadFromDB)

  useEffect(() => {
    autoInit()
  }, [autoInit])

  useEffect(() => {
    if (status === 'connected' && graphName) {
      loadFromDB()
    }
  }, [status, graphName, loadFromDB])

  return (
    <div className="flex flex-col h-full">
      <ConnectionStatus />
      <GraphSelector />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-[400px] flex flex-col border-r border-slate-700 bg-slate-900">
          <Tabs tabs={SIDEBAR_TABS} active={activeTab} onChange={setActiveTab} />
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'Builder' && <GraphBuilder />}
            {activeTab === 'Access' && <AccessPanel />}
            {activeTab === 'Relay' && <RelayPipeline />}
            {activeTab === 'Perf' && <PerfPanel />}
          </div>
        </div>

        {/* Graph Canvas */}
        <div className="flex-1">
          <AuthzGraph />
        </div>
      </div>

      <ProfilingBar />
    </div>
  )
}
