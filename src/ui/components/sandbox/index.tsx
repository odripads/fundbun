/**
 * Sandbox controls (demo only): simulate a purchase, advance the sandbox clock, switch persona.
 * MINIMAL VERSION — owned and polished by the safety/glass-box UI engineer. Keep the export names/props.
 */
import { useState } from 'react'
import { toMinor } from '../../../core/money'
import { useApp } from '../../state'
import { Button, TextField } from '../ds'

export interface SandboxPanelProps {
  /** compact layout for the desktop glass box */
  compact?: boolean
  onDone?: () => void
}

export function SandboxPanel({ onDone }: SandboxPanelProps) {
  const app = useApp()
  const [merchant, setMerchant] = useState('JD.com')
  const [amount, setAmount] = useState('1299')
  return (
    <div>
      <TextField label="Merchant" value={merchant} onChange={(e) => setMerchant(e.currentTarget.value)} />
      <TextField label="Amount" value={amount} onChange={(e) => setAmount(e.currentTarget.value)} />
      <Button
        onClick={() => {
          app.simulatePurchase({ merchant, amount: toMinor(Number(amount)) })
          onDone?.()
        }}
      >
        Simulate purchase
      </Button>
      <Button variant="secondary" onClick={() => app.advanceDays(1)}>
        Next day
      </Button>
    </div>
  )
}
