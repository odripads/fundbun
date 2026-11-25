import type { CategoryId, Currency, Minor, SpendMode } from '../types'

export type PluginSlot = 'dashboard' | 'home' | 'both'
export type PluginOrigin = 'chat' | 'starter' | 'user'
export type PluginIconId = 'sparkles' | 'coffee' | 'calendar' | 'gauge' | 'wallet' | 'chart' | 'flame' | 'target'

export interface PluginManifest {
  id: string
  name: string
  description: string
  version: number
  revision: number
  slot: PluginSlot
  wide: boolean
  icon: PluginIconId
  enabled: boolean
  createdAt: string
  updatedAt: string
  createdBy: PluginOrigin
}

export interface PluginRecord extends PluginManifest {
  code: string
  css: string
}

export interface PluginDraftInput {
  id?: string
  name: string
  description: string
  slot?: PluginSlot
  wide?: boolean
  icon?: PluginIconId
  code: string
  css?: string
  createdBy?: PluginOrigin
}

export interface PluginValidationIssue {
  rule: string
  line?: number
  column?: number
  message: string
  fix: string
}

export interface PluginDraftRecord {
  draftId: string
  mode: 'create' | 'update'
  manifest: PluginManifest
  code: string
  css: string
  previewUrl: string
  createdAt: string
}

export interface PluginStarter {
  id: string
  name: string
  description: string
  slot: PluginSlot
  wide: boolean
  icon: PluginIconId
  code: string
  css: string
}

export interface PluginsState {
  local: boolean
  enabled: boolean
  plugins: PluginManifest[]
  starters: PluginStarter[]
  pluginDir?: string
}

export const PLUGINS_UNAVAILABLE: PluginsState = {
  local: false,
  enabled: false,
  plugins: [],
  starters: [],
}

/**
 * Strictly read-only, PII-minimized view passed into every sandboxed plugin iframe via postMessage.
 * Contains no user name, PIN, API keys, account numbers, accountId, payeeId, raw description, memo,
 * chat messages, pending actions, or audit entries.
 */
export interface PluginFinanceSnapshot {
  today: string
  month: string
  currency: Currency
  mode: SpendMode
  summary: {
    income: Minor
    spent: Minor
    target: Minor
    projected: Minor
    safePerDay: Minor
    daysLeft: number
    byCategory: {
      category: CategoryId
      label: string
      spent: Minor
      budget: Minor
      lastMonth: Minor
    }[]
  } | null
  history: {
    month: string
    spent: Minor
    target: Minor
    income: Minor
  }[]
  goals: {
    id: string
    name: string
    kind: 'goal' | 'treat'
    price: Minor
    saved: Minor
    pct: number
    etaMonths: number | null
  }[]
  bills: {
    id: string
    name: string
    amountDue: Minor
    dueDate: string
    status: string
  }[]
  transactions: {
    id: string
    date: string
    time?: string
    merchant: string
    category: CategoryId
    amount: Minor
  }[]
  checkIn: {
    streak: number
    best: number
    golden: number
    checkedToday: boolean
  }
}
