import { Handle, Position, type NodeProps } from 'reactflow'
import { NODE_COLORS } from '@/types/graph'

export function ModuleNode({ data }: NodeProps) {
  const colors = NODE_COLORS.Module
  return (
    <div
      className="px-3 py-2 rounded-lg border-2 text-center min-w-[120px] shadow-lg relative"
      style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
    >
      <div className="text-[10px] uppercase tracking-wider opacity-70">Module</div>
      <div className="text-xs font-bold">{data.label}</div>
      {data.typeName && (
        <div
          className="absolute -top-2 -right-2 text-[8px] font-bold px-1.5 py-0.5 rounded-full"
          style={{
            backgroundColor: NODE_COLORS.Type.bg,
            color: NODE_COLORS.Type.text,
          }}
        >
          {data.typeName}
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  )
}
