import { Bot, KeyRound, Laptop } from 'lucide-react'
import { useId } from 'react'

export type BrandId =
  | 'claude'
  | 'antigravity'
  | 'gemini'
  | 'openai'
  | 'deepseek'
  | 'grok'
  | 'qwen'
  | 'kimi'
  | 'glm'
  | 'openrouter'
  | 'opencode'
  | 'ollama'
  | 'lmstudio'

const PRESET_BRAND: Record<string, BrandId> = {
  'claude-code': 'claude',
  anthropic: 'claude',
  antigravity: 'antigravity',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  openai: 'openai',
  codex: 'openai',
  deepseek: 'deepseek',
  xai: 'grok',
  qwen: 'qwen',
  'qwen-intl': 'qwen',
  'qwen-code': 'qwen',
  kimi: 'kimi',
  'kimi-code': 'kimi',
  glm: 'glm',
  openrouter: 'openrouter',
  opencode: 'opencode',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
}

const BRAND_BG: Record<BrandId, string> = {
  claude: 'rgba(217, 119, 87, 0.14)',
  antigravity: 'rgba(66, 133, 244, 0.12)',
  gemini: 'rgba(66, 133, 244, 0.13)',
  openai: 'rgba(16, 163, 127, 0.13)',
  deepseek: 'rgba(77, 107, 254, 0.13)',
  grok: 'rgba(24, 24, 27, 0.08)',
  qwen: 'rgba(97, 92, 237, 0.12)',
  kimi: 'rgba(37, 99, 235, 0.12)',
  glm: 'rgba(14, 165, 233, 0.13)',
  openrouter: 'rgba(99, 102, 241, 0.12)',
  opencode: 'rgba(16, 185, 129, 0.13)',
  ollama: 'rgba(31, 41, 55, 0.08)',
  lmstudio: 'rgba(99, 102, 241, 0.12)',
}

/** Identify which visual brand mark to show from a connection presetId, provider label, or model id. */
export function providerBrandOf(input: { presetId?: string; provider?: string; model?: string }): BrandId | null {
  if (input.presetId && PRESET_BRAND[input.presetId]) return PRESET_BRAND[input.presetId]
  const text = `${input.provider ?? ''} ${input.model ?? ''}`.toLowerCase()
  if (!text.trim()) return null
  if (/antigravity|\bagy\b/.test(text)) return 'antigravity'
  if (/claude|anthropic|sonnet|opus|haiku|fable/.test(text)) return 'claude'
  if (/gemini/.test(text)) return 'gemini'
  if (/deepseek/.test(text)) return 'deepseek'
  if (/\bgrok\b|\bxai\b/.test(text)) return 'grok'
  if (/openai|codex|\bgpt\b|\bo[134]-/.test(text)) return 'openai'
  if (/qwen/.test(text)) return 'qwen'
  if (/kimi|moonshot/.test(text)) return 'kimi'
  if (/\bglm\b|zhipu/.test(text)) return 'glm'
  if (/openrouter/.test(text)) return 'openrouter'
  if (/opencode/.test(text)) return 'opencode'
  if (/ollama/.test(text)) return 'ollama'
  if (/lm studio|lmstudio/.test(text)) return 'lmstudio'
  return null
}

/** Soft tinted icon-tile background matching each brand's palette. */
export function brandBg(brand: BrandId | null): string | undefined {
  return brand ? BRAND_BG[brand] : undefined
}

export interface ProviderLogoProps {
  presetId?: string
  provider?: string
  model?: string
  kind?: 'openai_compat' | 'anthropic' | 'agent'
  local?: boolean
  size?: number
}

/**
 * Crisp multi-color vector brand mark for AI providers and agents, falling back to generic icons
 * only for custom / unknown endpoints. Zero external image requests.
 */
export function ProviderLogo({ presetId, provider, model, kind, local, size }: ProviderLogoProps) {
  const brand = providerBrandOf({ presetId, provider, model })
  const uid = useId().replace(/:/g, '')
  const style = size ? { width: size, height: size } : undefined

  if (!brand) {
    if (local) return <Laptop aria-hidden="true" style={style} />
    if (kind === 'agent') return <Bot aria-hidden="true" style={style} />
    return <KeyRound aria-hidden="true" style={style} />
  }

  const svgProps = { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true as const, 'data-brand': brand, style }

  switch (brand) {
    case 'claude':
      return (
        <svg {...svgProps}>
          <g stroke="#D97757" strokeWidth="2.1" strokeLinecap="round">
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
            <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
            <line x1="8.4" y1="3.8" x2="15.6" y2="20.2" />
            <line x1="20.2" y1="8.4" x2="3.8" y2="15.6" />
          </g>
          <circle cx="12" cy="12" r="2.2" fill="#D97757" />
        </svg>
      )

    case 'antigravity':
      return (
        <svg {...svgProps}>
          <path d="M12 3.2L4.2 19.6h3.9l1.7-3.8h4.4l1.7 3.8h3.9L12 3.2z" fill="#4285F4" />
          <path d="M12 3.2L15.9 19.6h3.9L12 3.2z" fill="#34A853" opacity="0.92" />
          <path d="M7.5 14.5c2.9-1.9 6.1-1.9 9 0l-1.3 2.7c-2.1-1.1-4.3-1.1-6.4 0l-1.3-2.7z" fill="#FBBC05" />
          <circle cx="12" cy="8.2" r="1.8" fill="#EA4335" />
        </svg>
      )

    case 'gemini':
      return (
        <svg {...svgProps}>
          <defs>
            <linearGradient id={`gem-${uid}`} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#4285F4" />
              <stop offset="50%" stopColor="#9B72CB" />
              <stop offset="100%" stopColor="#D96570" />
            </linearGradient>
          </defs>
          <path
            d="M12 2.5c1.1 5 4.5 8.4 9.5 9.5-5 1.1-8.4 4.5-9.5 9.5-1.1-5-4.5-8.4-9.5-9.5 5-1.1 8.4-4.5 9.5-9.5z"
            fill={`url(#gem-${uid})`}
          />
        </svg>
      )

    case 'openai':
      return (
        <svg {...svgProps}>
          <g stroke="#10A37F" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="4.2" width="8" height="8" rx="4" transform="rotate(0 12 12)" />
            <rect x="8" y="4.2" width="8" height="8" rx="4" transform="rotate(60 12 12)" />
            <rect x="8" y="4.2" width="8" height="8" rx="4" transform="rotate(120 12 12)" />
            <rect x="8" y="4.2" width="8" height="8" rx="4" transform="rotate(180 12 12)" />
            <rect x="8" y="4.2" width="8" height="8" rx="4" transform="rotate(240 12 12)" />
            <rect x="8" y="4.2" width="8" height="8" rx="4" transform="rotate(300 12 12)" />
          </g>
        </svg>
      )

    case 'deepseek':
      return (
        <svg {...svgProps}>
          <path
            d="M4.2 13.5c0-4.4 3.7-7.8 8.3-7.8 3.6 0 6.7 2.2 7.6 5.4-1.4-.7-2.6-.5-3.4.3.7 3.9-2.4 7.4-6.9 7.4-3.2 0-5.6-2.3-5.6-5.3z"
            fill="#4D6BFE"
          />
          <circle cx="15.3" cy="11.2" r="1.2" fill="#FFFFFF" />
          <path d="M2.8 11.2c1.2-.3 2.1.3 2.5 1.3" stroke="#4D6BFE" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )

    case 'grok':
      return (
        <svg {...svgProps}>
          <circle cx="12" cy="12" r="7.5" stroke="#18181B" strokeWidth="2.1" />
          <path d="M5.5 18.5L18.8 5.2" stroke="#18181B" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )

    case 'qwen':
      return (
        <svg {...svgProps}>
          <defs>
            <linearGradient id={`qwen-${uid}`} x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#615CED" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </linearGradient>
          </defs>
          <path d="M12 3.2L19.8 12 12 20.8 4.2 12 12 3.2z" fill={`url(#qwen-${uid})`} />
          <circle cx="12" cy="12" r="2.7" fill="#FFFFFF" />
        </svg>
      )

    case 'kimi':
      return (
        <svg {...svgProps}>
          <path
            d="M15.8 4.6a7.8 7.8 0 1 0 3.6 14 6.4 6.4 0 0 1-3.6-14z"
            fill="#2563EB"
          />
          <circle cx="16.8" cy="7.5" r="1.6" fill="#60A5FA" />
        </svg>
      )

    case 'glm':
      return (
        <svg {...svgProps}>
          <path d="M5.5 6.5h13l-13 11h13" stroke="#0EA5E9" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="6.5" r="1.8" fill="#2563EB" />
        </svg>
      )

    case 'openrouter':
      return (
        <svg {...svgProps}>
          <circle cx="5.5" cy="12" r="2.2" fill="#6366F1" />
          <circle cx="18" cy="6.5" r="2.2" fill="#8B5CF6" />
          <circle cx="18" cy="17.5" r="2.2" fill="#EC4899" />
          <path d="M7.5 11.2L16 7.3M7.5 12.8l8.5 3.9" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )

    case 'opencode':
      return (
        <svg {...svgProps}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="4" fill="#0F172A" />
          <path d="M8 9.2l3.2 2.8L8 14.8M12.5 14.8H16" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )

    case 'ollama':
      return (
        <svg {...svgProps}>
          <path
            d="M7.5 5.2c0-1.1.9-1.7 1.7-.7l1.2 1.8h3.2l1.2-1.8c.8-1 1.7-.4 1.7.7v5.2a5.5 5.5 0 0 1 1 3.3c0 3.2-2.4 5.6-5.5 5.6s-5.5-2.4-5.5-5.6c0-1.2.4-2.3 1-3.3V5.2z"
            fill="#1F2937"
          />
          <circle cx="10.1" cy="12" r="1" fill="#FFFFFF" />
          <circle cx="13.9" cy="12" r="1" fill="#FFFFFF" />
        </svg>
      )

    case 'lmstudio':
      return (
        <svg {...svgProps}>
          <rect x="4" y="4" width="16" height="16" rx="4" fill="#6366F1" />
          <path d="M8 8.2v7.6h3.5M14.2 15.8l2-7.6 2 7.6" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
  }
}
