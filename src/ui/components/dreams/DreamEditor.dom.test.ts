// @vitest-environment jsdom
import { createElement as h } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DreamInput } from '../../../core/app-api'
import { byText, changeValue, cleanup, click, flush, render } from '../ds/testing'
import { DreamEditor } from './DreamEditor'

afterEach(async () => {
  await cleanup()
})

function picked(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLInputElement>('input[type=radio][name$="-picture"]:checked')?.value
}

function nameInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[placeholder="Weekend in Chengdu"]')!
}

function priceInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!
}

describe('DreamEditor', () => {
  it('offers all 16 presets, a photo option that stays on-device, and goal/treat', async () => {
    const { container } = await render(h(DreamEditor, { currency: 'CNY', onSubmit: () => {} }))
    expect(container.querySelectorAll('input[type=radio][name$="-picture"]')).toHaveLength(16)
    expect(container.querySelector('input[type=file][accept="image/*"]')).not.toBeNull()
    expect(container.textContent).toContain('never uploaded')
    expect(container.querySelectorAll('input[type=radio][name$="-kind"]')).toHaveLength(2)
  })

  it('a suggestion chip prefills the name, picture and kind — never the price', async () => {
    const { container } = await render(h(DreamEditor, { currency: 'CNY', onSubmit: () => {} }))
    await click(byText(container, 'New sneakers', 'button'))
    expect(nameInput(container).value).toBe('New sneakers')
    expect(picked(container)).toBe('sneakers')
    expect(container.querySelector<HTMLInputElement>('input[value="treat"]')!.checked).toBe(true)
    expect(priceInput(container).value).toBe('')
  })

  it('guesses the picture from the name until the user picks one', async () => {
    const { container } = await render(h(DreamEditor, { currency: 'CNY', onSubmit: () => {} }))
    await changeValue(nameInput(container), 'Weekend in Chengdu')
    expect(picked(container)).toBe('plane')
    await click(container.querySelector('input[value="camera"]'))
    await changeValue(nameInput(container), 'MacBook Air')
    expect(picked(container)).toBe('camera')
  })

  it('shows errors instead of submitting an incomplete dream', async () => {
    const onSubmit = vi.fn()
    const { container } = await render(h(DreamEditor, { currency: 'CNY', onSubmit, submitLabel: 'Add to my list' }))
    await click(byText(container, 'Add to my list', 'button'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(nameInput(container).getAttribute('aria-invalid')).toBe('true')
    expect(priceInput(container).getAttribute('aria-invalid')).toBe('true')
  })

  it('submits a DreamInput in minor units', async () => {
    const onSubmit = vi.fn<(input: DreamInput) => void>()
    const { container } = await render(h(DreamEditor, { currency: 'CNY', onSubmit, submitLabel: 'Add' }))
    await click(byText(container, 'Birkin', 'button'))
    await changeValue(priceInput(container), '98k')
    await click(byText(container, 'Add', 'button'))
    await flush()
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Birkin', price: 9_800_000, kind: 'goal', image: 'preset:bag' })
  })

  it('edits an existing item (Goals reuse): prefilled, no suggestions, cancel works', async () => {
    const onCancel = vi.fn()
    const initial = { name: 'Concert ticket', price: 48_000, kind: 'treat' as const, image: 'preset:ticket' }
    const { container } = await render(h(DreamEditor, { currency: 'CNY', initial, onSubmit: () => {}, onCancel }))
    expect(nameInput(container).value).toBe('Concert ticket')
    expect(priceInput(container).value).toBe('480')
    expect(picked(container)).toBe('ticket')
    expect(container.textContent).not.toContain('Need ideas?')
    await click(byText(container, 'Cancel', 'button'))
    expect(onCancel).toHaveBeenCalled()
  })
})
