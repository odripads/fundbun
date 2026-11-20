import { Camera, Gift, ShieldCheck, Target } from 'lucide-react'
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { DreamInput } from '../../../core/app-api'
import { targetPlan } from '../../../core/finance/dreams'
import { CURRENCY_SYMBOL, fmt } from '../../../core/money'
import type { Currency, DreamKind } from '../../../core/types'
import { DreamImage, isPhotoDataUrl } from '../brand'
import { Badge, Button, Chip, cx, Money, TextField } from '../ds'
import {
  DREAM_SUGGESTIONS,
  guessPreset,
  KIND_COPY,
  MAX_NAME,
  monthEnd,
  parsePrice,
  PRESET_LABELS,
  PRESETS,
  presetImage,
  priceText,
  validateDreamForm,
  type DreamFormErrors,
  type DreamSuggestion,
} from './logic'
import { photoToDataUrl } from './photo'
import styles from './DreamEditor.module.css'

export interface DreamEditorProps {
  currency: Currency
  /** today (the app's date): the earliest month a goal can be due */
  today?: string
  initial?: Partial<DreamInput>
  submitLabel?: string
  onSubmit: (input: DreamInput) => void
  onCancel?: () => void
  /** suggestion chips ("Birkin", "Weekend trip"…) that prefill name + picture; default: on for a new item */
  suggestions?: boolean
}

const KIND_ICON: Record<DreamKind, typeof Target> = { goal: Target, treat: Gift }

/**
 * Add or edit a dream item: name, price, goal/treat and a picture — one of the 16 preset illustrations or an
 * on-device photo (resized to ≤ 512 px, never uploaded). Until the user picks a picture, one is guessed from the
 * name ("Weekend in Chengdu" → the plane). A live preview card shows the item as it will appear.
 */
export function DreamEditor({ currency, today, initial, submitLabel = 'Save', onSubmit, onCancel, suggestions }: DreamEditorProps) {
  const id = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const priceRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(priceText(initial?.price, currency))
  const [kind, setKind] = useState<DreamKind>(initial?.kind ?? 'goal')
  // goals: by when (a month), optional
  const [by, setBy] = useState(initial?.targetDate ? initial.targetDate.slice(0, 7) : '')
  // '' = not chosen yet → the picture follows the name
  const [chosen, setChosen] = useState(initial?.image ?? '')
  const [attempted, setAttempted] = useState(false)
  const [photo, setPhoto] = useState<{ busy: boolean; error?: string }>({ busy: false })

  const image = chosen || presetImage(guessPreset(name) ?? 'gift')
  const isPhoto = isPhotoDataUrl(image)
  const showSuggestions = suggestions ?? !initial?.name
  const errors: DreamFormErrors = attempted ? errorsOf(validateDreamForm({ name, price, kind, image, by: by || (initial?.targetDate ? '' : undefined), today }, currency)) : {}
  const parsed = parsePrice(price, currency)
  // with a price and a month: what it takes, said before saving
  const byHint = (() => {
    if (kind !== 'goal' || !parsed.ok || !/^\d{4}-\d{2}$/.test(by)) return null
    const plan = targetPlan(monthEnd(by), parsed.minor, today ?? new Date().toISOString().slice(0, 10))
    return `About ${fmt(plan.neededMonthly, currency, { decimals: false })} a month, or ${fmt(plan.neededDaily, currency, { decimals: false })} a day, from now.`
  })()

  function applySuggestion(s: DreamSuggestion) {
    setName(s.name)
    setKind(s.kind)
    setChosen(presetImage(s.preset))
    // the price is the user's own: take them straight to it
    requestAnimationFrame(() => priceRef.current?.focus())
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (!file) return
    setPhoto({ busy: true })
    try {
      setChosen(await photoToDataUrl(file))
      setPhoto({ busy: false })
    } catch (err) {
      setPhoto({ busy: false, error: err instanceof Error ? err.message : 'Couldn’t read that photo.' })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    setAttempted(true)
    const result = validateDreamForm({ name, price, kind, image, by: by || (initial?.targetDate ? '' : undefined), today }, currency)
    if (!result.ok) {
      ;(result.errors.name ? nameRef : priceRef).current?.focus()
      return
    }
    onSubmit(result.input)
  }

  const KindIcon = KIND_ICON[kind]
  return (
    <form className={styles.editor} onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <div className={styles.preview} aria-hidden="true">
        <span key={image} className={styles.previewArt}>
          <DreamImage image={image} alt="" size={76} glow />
        </span>
        <span className={styles.previewText}>
          <span className={styles.previewKind}>
            <KindIcon />
            {KIND_COPY[kind].label}
          </span>
          <span className={cx(styles.previewName, !name.trim() && styles.placeholder)}>{name.trim() || 'Your next dream'}</span>
          <span className={styles.previewPrice}>
            {parsed.ok ? <Money amount={parsed.minor} currency={currency} size="md" /> : <span className={styles.placeholder}>Add a price</span>}
          </span>
        </span>
      </div>
      <p id={`${id}-title`} className="sr-only">Dream item</p>

      {showSuggestions ? (
        <div className={styles.suggest}>
          <p className={styles.caption} id={`${id}-ideas`}>Need ideas?</p>
          <div className={styles.chips} role="group" aria-labelledby={`${id}-ideas`}>
            {DREAM_SUGGESTIONS.map((s) => (
              <Chip key={s.name} onClick={() => applySuggestion(s)} icon={<DreamImage image={presetImage(s.preset)} alt="" size={22} className={styles.chipArt} />}>
                {s.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <TextField
        ref={nameRef}
        label="What is it?"
        placeholder="Weekend in Chengdu"
        value={name}
        maxLength={MAX_NAME}
        autoComplete="off"
        enterKeyHint="next"
        error={errors.name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <TextField
        ref={priceRef}
        label="How much?"
        prefix={CURRENCY_SYMBOL[currency]}
        placeholder="2,400"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        value={price}
        error={errors.price}
        hint="Shorthand works too: 2.4k or 1.2万"
        onChange={(e) => setPrice(e.currentTarget.value)}
      />

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Kind</legend>
        <div className={styles.kinds}>
          {(['goal', 'treat'] as const).map((k) => {
            const Icon = KIND_ICON[k]
            return (
              <label key={k} className={styles.kind} data-checked={kind === k || undefined}>
                <input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                <span className={styles.kindIcon} aria-hidden="true"><Icon /></span>
                <span className={styles.kindText}>
                  <span className={styles.kindLabel}>{KIND_COPY[k].label}</span>
                  <span className={styles.kindHint}>{KIND_COPY[k].hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {kind === 'goal' ? (
        <TextField
          label="By when? (optional)"
          type="month"
          placeholder="2027-12"
          min={today ? today.slice(0, 7) : undefined}
          value={by}
          error={errors.by}
          hint={byHint ?? 'A month you want it by. Bun works out what it takes.'}
          onChange={(e) => setBy(e.currentTarget.value)}
        />
      ) : null}

      <fieldset className={styles.group} aria-describedby={`${id}-photo-note`}>
        <legend className={styles.legend}>
          Picture
          {!chosen && name.trim() ? <Badge size="sm" variant="neutral">Matched to the name</Badge> : null}
        </legend>
        <div className={styles.grid}>
          {PRESETS.map((key) => {
            const value = presetImage(key)
            const checked = image === value
            return (
              <label key={key} className={styles.tile} data-checked={checked || undefined} title={PRESET_LABELS[key]}>
                <input type="radio" name={`${id}-picture`} value={key} checked={checked} onChange={() => setChosen(value)} className="sr-only" />
                <DreamImage image={value} alt="" size={44} className={styles.tileArt} />
                <span className="sr-only">{PRESET_LABELS[key]}</span>
              </label>
            )
          })}
          <label className={cx(styles.tile, styles.photoTile)} data-checked={isPhoto || undefined} data-busy={photo.busy || undefined}>
            <input type="file" accept="image/*" className="sr-only" onChange={onPhoto} disabled={photo.busy} />
            {isPhoto ? <img src={image} alt="" className={styles.photoThumb} /> : <Camera aria-hidden="true" className={styles.photoIcon} />}
            <span className={styles.photoLabel}>{photo.busy ? 'Resizing…' : isPhoto ? 'Change' : 'Your photo'}</span>
          </label>
        </div>
        <p id={`${id}-photo-note`} className={styles.note}>
          <ShieldCheck aria-hidden="true" />
          Photos are resized on this device and never uploaded.
        </p>
        {photo.error ? <p className={styles.error} role="alert">{photo.error}</p> : null}
      </fieldset>

      <div className={styles.actions}>
        {onCancel ? (
          <Button variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" className={styles.submit} disabled={photo.busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function errorsOf(result: ReturnType<typeof validateDreamForm>): DreamFormErrors {
  return result.ok ? {} : result.errors
}
