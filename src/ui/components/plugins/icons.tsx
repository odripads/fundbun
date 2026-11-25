import { CalendarDays, ChartColumn, Coffee, Flame, Gauge, Sparkles, Target, Wallet, type LucideIcon } from 'lucide-react'
import type { PluginIconId } from '../../../core/plugins/types'

export const PLUGIN_ICONS: Record<PluginIconId, LucideIcon> = {
  sparkles: Sparkles,
  coffee: Coffee,
  calendar: CalendarDays,
  gauge: Gauge,
  wallet: Wallet,
  chart: ChartColumn,
  flame: Flame,
  target: Target,
}

export function PluginIcon({ icon }: { icon: PluginIconId }) {
  const Icon = PLUGIN_ICONS[icon] ?? Sparkles
  return <Icon aria-hidden="true" />
}
