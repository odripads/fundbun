import { ChevronDown, Cpu } from 'lucide-react'
import { useState } from 'react'
import { formatAiLabel } from '../../../core/ai/labels'
import type { AppSnapshot, LlmStatus } from '../../../core/app-api'
import { shallowEqual, useSnapshot } from '../../state'
import { AiSheet } from './AiSheet'
import { ProviderLogo } from './ProviderLogo'
import styles from './Ai.module.css'

const selectAnswering = (s: AppSnapshot) => ({ llm: s.derived.llm, engine: s.derived.engine })

/** Who answers the next message, in a few words. */
export function answeringLabel(llm: LlmStatus, engine: 'offline' | 'llm'): string {
  if (engine !== 'llm') return 'Built-in engine'
  if (llm.kind === 'agent') return formatAiLabel(llm.provider, llm.model, llm.presetId) || 'Your agent'
  if (llm.local) return formatAiLabel(llm.provider, llm.model, llm.presetId) || 'Your AI'
  return 'AI model'
}

/**
 * The model picker under the message box: shows who answers, opens "Your AI". Only offered where a connection
 * is possible (FundBun running on this computer) or already in use.
 */
export function ModelChip() {
  const { llm, engine } = useSnapshot(selectAnswering, shallowEqual)
  const [open, setOpen] = useState(false)
  const icon =
    engine !== 'llm'
      ? <Cpu />
      : <ProviderLogo presetId={llm.presetId} provider={llm.provider} model={llm.model} kind={llm.kind} local={llm.onDevice} />
  const label = answeringLabel(llm, engine)
  return (
    <>
      <button type="button" className={styles.chip} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Answering: ${label}. Change your AI`}>
        {icon}
        <span className={styles.chipText}>{label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      <AiSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
