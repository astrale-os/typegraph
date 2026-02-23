import { clsx } from 'clsx'

type BadgeVariant = 'granted' | 'denied' | 'filtered' | 'missing' | 'type' | 'resource'

const variants: Record<BadgeVariant, string> = {
  granted: 'bg-green-500/20 text-green-400 border-green-500/30',
  denied: 'bg-red-500/20 text-red-400 border-red-500/30',
  filtered: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  missing: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  type: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  resource: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

interface StatusBadgeProps {
  variant: BadgeVariant
  children: React.ReactNode
  className?: string
}

export function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
