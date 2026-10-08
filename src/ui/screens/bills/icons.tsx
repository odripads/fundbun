/** Icon vocabulary for the Bills screen (lucide). Icons always sit next to text — never the only signal. */
import {
  AppWindow,
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  Clock,
  Cloud,
  Copy,
  CreditCard,
  Droplets,
  Dumbbell,
  Gamepad2,
  House,
  Layers,
  Music,
  OctagonAlert,
  PiggyBank,
  Receipt,
  Repeat,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  TriangleAlert,
  Info,
  Tv,
  Wifi,
  Zap,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { BillFinding, FindingKind } from '../../../core/types'
import type { BillIcon, NicheKey, StatusIcon } from './billsView'

export const BILL_ICON: Record<BillIcon, ReactNode> = {
  power: <Zap />,
  water: <Droplets />,
  home: <House />,
  phone: <Smartphone />,
  wifi: <Wifi />,
  card: <CreditCard />,
  shield: <ShieldCheck />,
  receipt: <Receipt />,
}

export const STATUS_ICON: Record<StatusIcon, ReactNode> = {
  paid: <CircleCheck />,
  scheduled: <CalendarCheck />,
  overdue: <CircleAlert />,
  soon: <CalendarClock />,
  upcoming: <Clock />,
}

export const KIND_ICON: Record<FindingKind, ReactNode> = {
  price_hike: <TrendingUp />,
  duplicate_charge: <Copy />,
  due_soon: <CalendarClock />,
  overdue: <CircleAlert />,
  bill_spike: <Zap />,
  subscription_overlap: <Layers />,
  annual_cost: <PiggyBank />,
  unusual_amount: <TrendingUp />,
}

export const SEVERITY_ICON: Record<BillFinding['severity'], ReactNode> = {
  alert: <OctagonAlert />,
  warn: <TriangleAlert />,
  info: <Info />,
}

export const NICHE_ICON: Record<NicheKey, ReactNode> = {
  video: <Tv />,
  music: <Music />,
  cloud: <Cloud />,
  fitness: <Dumbbell />,
  software: <AppWindow />,
  gaming: <Gamepad2 />,
  other: <Repeat />,
}

export const VERIFIED_ICON = <BadgeCheck />
