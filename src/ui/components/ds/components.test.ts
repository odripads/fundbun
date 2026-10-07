// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BarChart,
  Button,
  Callout,
  Checkbox,
  Chip,
  Dialog,
  Donut,
  EmptyState,
  IconButton,
  List,
  ListItem,
  Money,
  PinPad,
  ProgressBar,
  ProgressRing,
  Segmented,
  Sheet,
  Slider,
  Sparkline,
  StackedBar,
  Stat,
  Tabs,
  TextField,
  TierBadge,
  AiBadge,
  Toggle,
  ToastProvider,
  ToastViewport,
  useToast,
  type ToastApi,
} from './index'
import { byLabel, byText, changeValue, cleanup, click, flush, key, render } from './testing'

afterEach(async () => {
  vi.useRealTimers()
  await cleanup()
})

describe('Button', () => {
  it('renders a button with its label and handles clicks', async () => {
    const onClick = vi.fn()
    const { container } = await render(h(Button, { onClick }, 'Move ¥300'))
    const btn = container.querySelector('button')!
    expect(btn.type).toBe('button')
    expect(btn.textContent).toBe('Move ¥300')
    await click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('ignores clicks while loading and announces busy', async () => {
    const onClick = vi.fn()
    const { container } = await render(h(Button, { onClick, loading: true }, 'Paying'))
    const btn = container.querySelector('button')!
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.disabled).toBe(false)
    await click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders a link when given href', async () => {
    const { container } = await render(h(Button, { href: '#/home' }, 'Home'))
    expect(container.querySelector('a')?.getAttribute('href')).toBe('#/home')
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('IconButton', () => {
  it('requires a label and folds the badge into the accessible name', async () => {
    const { container } = await render(h(IconButton, { label: 'Activity', icon: h('svg'), badge: 3 }))
    const btn = container.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toBe('Activity (3)')
    expect(btn.getAttribute('title')).toBe('Activity')
  })

  it('announces a dot badge as new', async () => {
    const { container } = await render(h(IconButton, { label: 'Bell', icon: h('svg'), badge: true }))
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('Bell (new)')
  })
})

describe('Badges', () => {
  it('TierBadge carries code, label and a description', async () => {
    const { container } = await render(h(TierBadge, { tier: 4 }))
    const el = container.querySelector('[data-tier="4"]')!
    expect(el.textContent).toContain('T4')
    expect(el.textContent).toContain('Prohibited')
    expect(el.getAttribute('title')).toMatch(/Never allowed/)
  })

  it('AiBadge names the engine for assistive tech', async () => {
    const { container } = await render(h(AiBadge, { engine: 'offline' }))
    expect(container.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('AI-generated · On-device')
  })
})

describe('Money', () => {
  it('speaks the full amount and hides the typeset parts', async () => {
    const { container } = await render(h(Money, { amount: -129900, compact: true, size: 'hero' }))
    expect(container.querySelector('.sr-only')!.textContent).toBe('minus ¥1,299')
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('−¥1,299')
  })
})

describe('Progress', () => {
  it('ProgressBar exposes value, cap and an over hint', async () => {
    const { container } = await render(h(ProgressBar, { label: 'Month', value: 12240, max: 9500, tone: 'budget' }))
    const bar = container.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('9500')
    expect(bar.getAttribute('aria-valuetext')).toBe('129% (over)')
    const labelId = bar.getAttribute('aria-labelledby')!
    expect(container.querySelector(`[id="${labelId}"]`)!.textContent).toBe('Month')
  })

  it('ProgressRing labels itself and renders centre content', async () => {
    const { container } = await render(h(ProgressRing, { value: 46, label: 'MacBook saved' }, h('span', null, '46%')))
    const ring = container.querySelector('[role="progressbar"]')!
    expect(ring.getAttribute('aria-label')).toBe('MacBook saved')
    expect(ring.getAttribute('aria-valuetext')).toBe('46%')
    expect(ring.textContent).toContain('46%')
  })
})

describe('Toggle and Checkbox', () => {
  it('Toggle is a switch that flips', async () => {
    const onChange = vi.fn()
    const { container } = await render(h(Toggle, { checked: false, onChange, label: 'Glass box', description: 'Shows the trace' }))
    const sw = container.querySelector('[role="switch"]')!
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(container.querySelector(`[id="${sw.getAttribute('aria-describedby')}"]`)!.textContent).toBe('Shows the trace')
    await click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
    await click(byText(container, 'Glass box'))
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('Checkbox starts unticked when told and reports changes', async () => {
    const onChange = vi.fn()
    const { container } = await render(h(Checkbox, { checked: false, onChange, label: 'Use my data' }))
    const input = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(input.checked).toBe(false)
    await click(input)
    expect(onChange).toHaveBeenCalledWith(true)
  })
})

describe('Segmented', () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [v, setV] = useState('gentle')
    return h(Segmented<string>, {
      label: 'Tone',
      value: v,
      onChange: (x: string) => {
        setV(x)
        onChange(x)
      },
      options: [
        { value: 'gentle', label: 'Gentle' },
        { value: 'cheeky', label: 'Cheeky' },
        { value: 'numbers', label: 'Numbers' },
      ],
    })
  }

  it('is a radio group with roving focus', async () => {
    const onChange = vi.fn()
    const { container } = await render(h(Harness, { onChange }))
    const radios = Array.from(container.querySelectorAll('[role="radio"]')) as HTMLElement[]
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
    radios[0].focus()
    await key(radios[0], 'ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith('cheeky')
    expect(document.activeElement).toBe(radios[1])
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    await key(radios[1], 'End')
    expect(onChange).toHaveBeenLastCalledWith('numbers')
  })
})

describe('Tabs', () => {
  it('selects with arrows and links tab to panel', async () => {
    function Harness() {
      const [v, setV] = useState('a')
      return h(Tabs<string>, {
        label: 'Period',
        value: v,
        onChange: setV,
        items: [
          { id: 'a', label: 'This month', content: 'Panel A' },
          { id: 'b', label: 'Last month', content: 'Panel B' },
        ],
      })
    }
    const { container } = await render(h(Harness))
    const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[]
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    await key(tabs[0], 'ArrowRight')
    const panel = container.querySelector('[role="tabpanel"]')!
    expect(panel.textContent).toBe('Panel B')
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1].id)
    expect(tabs[1].getAttribute('aria-controls')).toBe(panel.id)
  })
})

describe('Slider', () => {
  it('maps the native range to discrete steps', async () => {
    const onChange = vi.fn()
    const steps = [
      { value: 'observe', label: 'Observe', hint: 'Reads only' },
      { value: 'suggest', label: 'Suggest', hint: 'Asks first' },
      { value: 'copilot', label: 'Copilot' },
    ]
    const { container } = await render(h(Slider<string>, { label: 'Autonomy', steps, value: 'observe', onChange }))
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.getAttribute('aria-valuetext')).toBe('Observe: Reads only')
    expect(input.max).toBe('2')
    await changeValue(input, '2')
    expect(onChange).toHaveBeenCalledWith('copilot')
  })
})

describe('PinPad', () => {
  it('accepts keyboard digits and auto-submits at the fixed length', async () => {
    const onComplete = vi.fn()
    const { container } = await render(h(PinPad, { length: 4, onComplete }))
    const group = container.querySelector('[role="group"]')!
    expect(document.activeElement).toBe(group)
    for (const d of ['2', '5', 'x', '8', '0']) await key(group, d)
    expect(onComplete).toHaveBeenCalledWith('2580')
  })

  it('supports the on-screen keypad and backspace', async () => {
    const onComplete = vi.fn()
    const { container } = await render(h(PinPad, { length: 4, onComplete, autoFocus: false }))
    const pressDigit = (d: string) => click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === d) ?? null)
    await pressDigit('1')
    await pressDigit('9')
    await click(byLabel(container, 'Delete last digit'))
    for (const d of ['2', '3', '4']) await pressDigit(d)
    expect(onComplete).toHaveBeenCalledWith('1234')
    expect(container.querySelector('[role="status"]')!.textContent).toBe('4 of 4 digits entered')
  })

  it('variable length submits on Enter only within bounds', async () => {
    const onComplete = vi.fn()
    const { container } = await render(h(PinPad, { minLength: 4, maxLength: 6, onComplete }))
    const group = container.querySelector('[role="group"]')!
    for (const d of '123') await key(group, d)
    await key(group, 'Enter')
    expect(onComplete).not.toHaveBeenCalled()
    expect((byLabel(container, 'Confirm PIN') as HTMLButtonElement).disabled).toBe(true)
    for (const d of '4567') await key(group, d)
    await key(group, 'Enter')
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  it('Enter on a focused key is that key, not a submit', async () => {
    const onComplete = vi.fn()
    const { container } = await render(h(PinPad, { minLength: 4, maxLength: 6, onComplete }))
    const one = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '1')!
    await key(one, 'Enter')
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('shows an error, clears the entry and hides the error once typing resumes', async () => {
    const onComplete = vi.fn()
    const r = await render(h(PinPad, { length: 4, onComplete, error: null }))
    const group = r.container.querySelector('[role="group"]')!
    await key(group, '1')
    await r.rerender(h(PinPad, { length: 4, onComplete, error: 'Wrong PIN', errorKey: 1 }))
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe('Wrong PIN')
    expect(r.container.querySelector('[role="status"]')!.textContent).toBe('0 of 4 digits entered')
    await key(group, '7')
    expect(r.container.querySelector('[role="alert"]')!.textContent).toBe('')
  })

  it('ignores input while busy and calls onCancel on Escape', async () => {
    const onComplete = vi.fn()
    const onCancel = vi.fn()
    const { container } = await render(h(PinPad, { length: 4, onComplete, busy: true, onCancel }))
    const group = container.querySelector('[role="group"]')!
    for (const d of '1234') await key(group, d)
    expect(onComplete).not.toHaveBeenCalled()
    expect(container.querySelector('[role="status"]')!.textContent).toBe('Checking PIN')
    await key(group, 'Escape')
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('Sheet and Dialog', () => {
  it('Sheet is a labelled modal dialog that closes on Escape, backdrop and the close button', async () => {
    const onClose = vi.fn()
    await render(h(Sheet, { open: true, onClose, title: 'Move ¥300', description: 'To Birkin pot' }, h('button', null, 'Inside')))
    const dialog = document.body.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe('Move ¥300')
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe('To Birkin pot')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.documentElement.hasAttribute('data-scroll-locked')).toBe(true)
    await key(document.body, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    await click(dialog.previousElementSibling)
    expect(onClose).toHaveBeenCalledTimes(2)
    await click(byLabel(dialog, 'Close'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('a non-dismissible sheet ignores Escape and the backdrop', async () => {
    const onClose = vi.fn()
    await render(h(Sheet, { open: true, onClose, title: 'Paying', dismissible: false }))
    await key(document.body, 'Escape')
    await click(document.body.querySelector('[role="dialog"]')!.previousElementSibling)
    expect(onClose).not.toHaveBeenCalled()
    expect(byLabel(document.body, 'Close')).toBeNull()
  })

  it('traps Tab inside the panel', async () => {
    await render(h(Sheet, { open: true, onClose: () => {}, title: 'Trap' }, h('button', null, 'A'), h('button', null, 'B')))
    const dialog = document.body.querySelector('[role="dialog"]')!
    const buttons = Array.from(dialog.querySelectorAll('button'))
    const last = buttons[buttons.length - 1]
    last.focus()
    await key(last, 'Tab')
    expect(document.activeElement).toBe(buttons[0])
    await key(buttons[0], 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('Escape closes only the topmost of stacked modals and the lock releases after both close', async () => {
    const closeSheet = vi.fn()
    const closeDialog = vi.fn()
    const r = await render(
      h('div', null,
        h(Sheet, { open: true, onClose: closeSheet, title: 'Sheet' }),
        h(Dialog, { open: true, onClose: closeDialog, title: 'Sure?', alert: true }),
      ),
    )
    expect(document.body.querySelector('[role="alertdialog"]')).not.toBeNull()
    await key(document.body, 'Escape')
    expect(closeDialog).toHaveBeenCalledTimes(1)
    expect(closeSheet).not.toHaveBeenCalled()
    await r.rerender(h('div', null, h(Sheet, { open: false, onClose: closeSheet, title: 'Sheet' }), h(Dialog, { open: false, onClose: closeDialog, title: 'Sure?' })))
    await flush(300)
    expect(document.body.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull()
    expect(document.documentElement.hasAttribute('data-scroll-locked')).toBe(false)
  })
})

describe('Toast', () => {
  let api: ToastApi
  function Grab() {
    api = useToast()
    return null
  }
  const mount = () => render(h(ToastProvider, null, h(Grab), h(ToastViewport)))

  it('shows a toast and announces it politely', async () => {
    await mount()
    await act(async () => {
      api.show({ title: 'Moved ¥300', message: 'Undo within 10 s' })
    })
    expect(byText(document.body, 'Moved ¥300', 'p')).not.toBeNull()
    expect(document.body.querySelector('[role="status"][aria-live="polite"]')!.textContent).toBe('Moved ¥300. Undo within 10 s')
    expect(document.body.querySelector('[role="alert"]')!.textContent).toBe('')
  })

  it('announces danger toasts assertively', async () => {
    await mount()
    await act(async () => {
      api.show({ title: 'Blocked', tone: 'danger' })
    })
    expect(document.body.querySelector('[role="alert"][aria-live="assertive"]')!.textContent).toBe('Blocked')
  })

  it('auto-dismisses and fires onDismiss', async () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    await mount()
    await act(async () => {
      api.show({ title: 'Bye', duration: 1000, onDismiss })
    })
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(byText(document.body, 'Bye', 'p')).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps sticky toasts and runs actions (dismissing by default)', async () => {
    vi.useFakeTimers()
    const onUndo = vi.fn()
    await mount()
    await act(async () => {
      api.show({ title: 'Sticky', duration: 0, actions: [{ label: 'Undo', onClick: onUndo }] })
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(byText(document.body, 'Sticky', 'p')).not.toBeNull()
    await click(byText(document.body, 'Undo', 'button'))
    expect(onUndo).toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(byText(document.body, 'Sticky', 'p')).toBeNull()
  })

  it('dismiss button removes the toast', async () => {
    await mount()
    await act(async () => {
      api.show({ title: 'Close me', duration: 0 })
    })
    await click(byLabel(document.body, 'Dismiss: Close me'))
    await flush(250)
    expect(byText(document.body, 'Close me', 'p')).toBeNull()
  })

  it('useToast outside a provider throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(render(h(Grab))).rejects.toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})

describe('Charts', () => {
  const data = [
    { id: 'dining', label: 'Dining', value: 124000, limit: 90000 },
    { id: 'coffee', label: 'Coffee', value: 41800, limit: 45000 },
  ]

  it('BarChart is an image with a summary and a table twin', async () => {
    const { container } = await render(h(BarChart, { data, label: 'October' }))
    const img = container.querySelector('[role="img"]')!
    expect(img.getAttribute('aria-label')).toContain('over limit: Dining by ¥340')
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.querySelector('caption')!.textContent).toBe('October')
  })

  it('BarChart with onSelect renders labelled buttons instead', async () => {
    const onSelect = vi.fn()
    const { container } = await render(h(BarChart, { data, label: 'October', onSelect }))
    expect(container.querySelector('[role="img"]')).toBeNull()
    const btn = byLabel(container, 'Dining: ¥1,240 of ¥900 limit, ¥340 over')!
    await click(btn)
    expect(onSelect).toHaveBeenCalledWith('dining')
  })

  it('Sparkline, Donut and StackedBar expose summaries and tables', async () => {
    const { container } = await render(
      h('div', null,
        h(Sparkline, { values: [100, 300], label: 'Trend', labels: ['Sep', 'Oct'] }),
        h(Donut, { data: [{ id: 'a', label: 'Needs', value: 300 }, { id: 'b', label: 'Wants', value: 100 }], label: 'Split' }),
        h(StackedBar, { data: [{ id: 'a', label: 'Needs', value: 300 }], label: 'Stack', total: 600, markers: [{ value: 500, label: 'target' }] }),
      ),
    )
    const labels = Array.from(container.querySelectorAll('[role="img"]')).map((e) => e.getAttribute('aria-label'))
    expect(labels[0]).toMatch(/^Trend: 2 points, up/)
    expect(labels[1]).toMatch(/^Split, total ¥4: Needs ¥3 \(75%\)/)
    expect(labels[2]).toMatch(/^Stack, ¥3 of ¥6: .* target: ¥5\.$/)
    expect(container.querySelectorAll('table')).toHaveLength(3)
  })
})

describe('Content components', () => {
  it('Chip variants: static, toggle and removable', async () => {
    const onRemove = vi.fn()
    const onClick = vi.fn()
    const { container } = await render(
      h('div', null,
        h(Chip, null, 'Static'),
        h(Chip, { selected: true, onClick }, 'Filter'),
        h(Chip, { onRemove }, 'Delivery'),
      ),
    )
    expect(byText(container, 'Static')!.closest('button')).toBeNull()
    const toggle = byText(container, 'Filter')!.closest('button')!
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    await click(toggle)
    expect(onClick).toHaveBeenCalled()
    await click(byLabel(container, 'Remove Delivery'))
    expect(onRemove).toHaveBeenCalled()
  })

  it('ListItem renders a button, a link or a plain row', async () => {
    const onClick = vi.fn()
    const { container } = await render(
      h(List, null,
        h(ListItem, { title: 'Meituan', onClick }),
        h(ListItem, { title: 'Pot', href: '#/goals' }),
        h(ListItem, { title: 'Salary' }),
      ),
    )
    expect(container.querySelectorAll('li')).toHaveLength(3)
    await click(byText(container, 'Meituan')!.closest('button'))
    expect(onClick).toHaveBeenCalled()
    expect(byText(container, 'Pot')!.closest('a')!.getAttribute('href')).toBe('#/goals')
    expect(byText(container, 'Salary')!.closest('a, button')).toBeNull()
  })

  it('TextField links label, hint and error', async () => {
    const { container } = await render(h(TextField, { label: 'Amount', prefix: '¥', error: 'Enter an amount' }))
    const input = container.querySelector('input')!
    expect(container.querySelector('label')!.htmlFor).toBe(input.id)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe('Enter an amount')
  })

  it('Callout block is an alert; EmptyState and Stat render their text', async () => {
    const { container } = await render(
      h('div', null,
        h(Callout, { tone: 'block', title: 'Blocked' }, 'T4 action'),
        h(EmptyState, { title: 'No bills due', body: 'All clear' }),
        h(Stat, { label: 'Spent', value: '¥12,240', delta: { label: '+23%', direction: 'up', good: false } }),
      ),
    )
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Blocked')
    expect(byText(container, 'No bills due')).not.toBeNull()
    expect(byText(container, '+23%')).not.toBeNull()
  })
})
