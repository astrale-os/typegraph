interface TabsProps {
  tabs: string[]
  active: string
  onChange: (tab: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex border-b border-slate-700">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-4 py-2 text-xs font-medium transition-colors ${
            active === tab
              ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800/50'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
