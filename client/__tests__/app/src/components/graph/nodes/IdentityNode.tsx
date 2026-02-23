import { Handle, Position, type NodeProps } from 'reactflow'
import { NODE_COLORS } from '@/types/graph'

export function IdentityNode({ data }: NodeProps) {
  const colors = NODE_COLORS.Identity
  return (
    <div
      className="px-3 py-2 rounded-lg border-2 text-center min-w-[120px] shadow-lg"
      style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
    >
      <div className="text-[10px] uppercase tracking-wider opacity-70">Identity</div>
      <div className="text-xs font-bold">{data.label}</div>
      <Handle type="target" position={Position.Top} className="!bg-slate-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400 !w-2 !h-2" />
    </div>
  )
}
