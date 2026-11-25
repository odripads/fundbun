import { Bot, Check, ChevronLeft, CircleAlert, Cpu, KeyRound, Laptop, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AiConnection, AiPreset, ConnectionTest, DetectedAgent, ModelOption } from '../../../core/ai/types'
import { Badge, Button, Callout, Sheet, Spinner, TextField, cx } from '../ds'
import { useAi } from './aiStore'
import styles from './Ai.module.css'

export const REPO_URL = 'https://github.com/odripads/fundbun'
const CUSTOM_AGENT = 'custom-agent'

type View = { name: 'list' } | { name: 'pick' } | { name: 'key'; preset: AiPreset } | { name: 'agent'; agent: DetectedAgent } | { name: 'command' }
/** a connection's models: asked for, still coming, or it could not say */
type ModelList = ModelOption[] | 'loading' | 'failed'

/** What a connection is, in a few words under its name. */
export function describeConnection(c: AiConnection): string {
  if (c.kind === 'agent') {
    const model = c.modelName || c.model
    return model ? `${model} · agent on this computer, your own sign-in` : 'An agent on this computer, with your own sign-in'
  }
  if (c.local) return `${c.model ?? 'No model picked'} · runs on this computer`
  return `${c.model ?? 'No model picked'} · your own key`
}

export function testLine(t: ConnectionTest): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (!t.ok) return { tone: 'bad', text: t.error ?? 'It did not answer.' }
  const secs = (t.ms / 1000).toFixed(1)
  if (t.kind === 'agent') {
    const found = t.modelCount ? `, ${t.modelCount} model${t.modelCount === 1 ? '' : 's'} found` : ''
    return { tone: 'ok', text: `Connected in ${secs} s (ask-first mode verified${found}).` }
  }
  if (t.tools === false) return { tone: 'warn', text: `Answered in ${secs} s, but did not use a tool when asked. Bun needs a model that can call tools to read your numbers.` }
  return { tone: 'ok', text: `Answered in ${secs} s and can use FundBun's tools.` }
}

/** The Model list: what the connection offers, and the model in use first when it is no longer offered. */
export function modelChoices(c: AiConnection, offered: readonly ModelOption[]): ModelOption[] {
  if (!c.model || offered.some((o) => o.id === c.model)) return [...offered]
  return [{ id: c.model, name: c.modelName || c.model }, ...offered]
}

/** A model as the list shows it: its name, and its id too when they differ. */
export function optionLabel(o: ModelOption): string {
  return o.name && o.name !== o.id ? `${o.name} (${o.id})` : o.name || o.id
}

/**
 * "Your AI": plug in the AI you already have. The built-in engine is always there; a connection adds a model
 * (your key, a model on this computer, or an agent you are signed in to). FundBun's rules decide either way.
 */
export function AiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useAi()
  const { ai, loaded } = api
  const [view, setView] = useState<View>({ name: 'list' })
  const [busy, setBusy] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, ConnectionTest>>({})
  const [models, setModels] = useState<Record<string, ModelList>>({})
  const active = ai.connections.find((c) => c.id === ai.activeId) ?? null

  useEffect(() => {
    if (open) {
      setView({ name: 'list' })
      void api.refresh()
    }
    // refresh once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // the model list of the connection in use, fetched once (an agent is asked by starting it: that can take a while)
  useEffect(() => {
    const known = active ? models[active.id] : undefined
    if (!open || !active || (known && known !== 'failed')) return
    void loadModels(active.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active?.id])

  async function loadModels(id: string) {
    setModels((m) => ({ ...m, [id]: 'loading' }))
    const list = await api.models(id)
    setModels((m) => ({ ...m, [id]: list ?? 'failed' }))
  }

  async function run<T>(key: string, job: () => Promise<T>): Promise<T | undefined> {
    setBusy(key)
    try {
      return await job()
    } finally {
      setBusy(null)
    }
  }

  async function test(id: string) {
    const t = await run(`test:${id}`, () => api.test(id))
    if (!t) return
    setTests((all) => ({ ...all, [id]: t }))
    // a working agent has just said which models it has
    if (t.ok && t.kind === 'agent') void loadModels(id)
  }

  /** Every new connection is tested at once: an agent really starts, so a missing sign-in shows now, not mid-chat. */
  async function connected(id: string) {
    setView({ name: 'list' })
    await test(id)
  }

  const title = view.name === 'list' ? 'Your AI' : view.name === 'pick' ? 'Connect an AI' : view.name === 'key' ? view.preset.name : view.name === 'agent' ? view.agent.name : 'Another agent'
  const description =
    view.name === 'list'
      ? 'Bun thinks with the AI you connect. FundBun’s rules still decide what it may do, and paying still needs your PIN.'
      : view.name === 'pick'
        ? 'Use what you already have. FundBun sells no tokens.'
        : undefined

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} size="full">
      {view.name !== 'list' ? (
        <button type="button" className={styles.back} onClick={() => setView(view.name === 'pick' ? { name: 'list' } : { name: 'pick' })}>
          <ChevronLeft aria-hidden="true" /> Back
        </button>
      ) : null}

      {view.name === 'list' ? (
        !loaded ? (
          <p className={styles.loading}><Spinner size={18} /> Looking for FundBun on this computer…</p>
        ) : !ai.local ? (
          <WebOnly />
        ) : (
          <div className={styles.stack}>
            <ul className={styles.options} role="radiogroup" aria-label="Who answers">
              <Option
                selected={!active}
                icon={<Cpu />}
                name="Built-in engine"
                sub="Rules on this device. No AI model, nothing leaves."
                busy={busy === 'use:none'}
                onSelect={() => void run('use:none', () => api.use(null))}
              />
              {ai.connections.map((c) => (
                <Option
                  key={c.id}
                  selected={c.id === ai.activeId}
                  icon={c.kind === 'agent' ? <Bot /> : c.local ? <Laptop /> : <KeyRound />}
                  name={c.label}
                  sub={describeConnection(c)}
                  warn={c.lastError}
                  busy={busy === `use:${c.id}`}
                  onSelect={() => void run(`use:${c.id}`, () => api.use(c.id))}
                >
                  {c.id === ai.activeId ? (
                    <div className={styles.detail}>
                      <ModelPicker
                        connection={c}
                        list={models[c.id]}
                        disabled={busy !== null}
                        onPick={(o) => void run(`model:${c.id}`, () => api.setModel(c.id, o.id, c.kind === 'agent' ? o.name : undefined))}
                      />
                      {c.kind === 'agent' ? (
                        <p className={styles.note}>
                          Runs as <code className={styles.mono}>{(c.command ?? []).join(' ') || 'its own command'}</code>, started in FundBun’s own folder. FundBun puts it in its ask-first mode, so it asks you before it runs commands or changes files.
                        </p>
                      ) : null}
                      <div className={styles.rowActions}>
                        <Button variant="secondary" size="sm" loading={busy === `test:${c.id}`} onClick={() => void test(c.id)}>Test</Button>
                        <Button variant="ghost" size="sm" iconStart={<Trash2 />} loading={busy === `rm:${c.id}`} onClick={() => void run(`rm:${c.id}`, () => api.remove(c.id))}>
                          Remove
                        </Button>
                      </div>
                      {tests[c.id] ? <TestResult test={tests[c.id]} /> : null}
                    </div>
                  ) : null}
                </Option>
              ))}
            </ul>
            <Button variant="primary" fullWidth iconStart={<Plus />} onClick={() => setView({ name: 'pick' })}>Connect an AI</Button>
            <p className={styles.small}>{ai.keyStorage}</p>
            <div className={styles.plans} aria-label="Plans">
              <p><strong>Free.</strong> Bring your own AI. FundBun and its built-in engine cost nothing.</p>
              <p><strong>Pro (planned).</strong> FundBun supplies the model, so there is nothing to connect. Not available yet.</p>
            </div>
          </div>
        )
      ) : null}

      {view.name === 'pick' ? <Picker presets={ai.presets} agents={ai.agents} onPick={setView} /> : null}

      {view.name === 'key' ? (
        <KeyForm
          preset={view.preset}
          onSubmit={async (input) => {
            const r = await api.add(input)
            if (r.ok) await connected(r.id)
            return r.ok ? null : r.error
          }}
        />
      ) : null}

      {view.name === 'agent' ? (
        <AgentConfirm
          agent={view.agent}
          onConnect={async () => {
            const r = await api.add({ presetId: view.agent.id })
            if (r.ok) await connected(r.id)
            return r.ok ? null : r.error
          }}
        />
      ) : null}

      {view.name === 'command' ? (
        <CommandForm
          onSubmit={async (label, command) => {
            const r = await api.add({ presetId: CUSTOM_AGENT, label, command })
            if (r.ok) await connected(r.id)
            return r.ok ? null : r.error
          }}
        />
      ) : null}
    </Sheet>
  )
}

function WebOnly() {
  return (
    <div className={styles.stack}>
      <Callout tone="info" title="This is the web version">
        Here Bun answers with the built-in engine on this device. To plug in your own AI (Claude Code, Antigravity, Codex, DeepSeek, Qwen, Grok, a model on your laptop), use the FundBun desktop app, which runs on your computer and keeps your keys there.
      </Callout>
      <Button href={REPO_URL} target="_blank" rel="noreferrer" variant="secondary" fullWidth>How to get the desktop app</Button>
    </div>
  )
}

function Option({ selected, icon, name, sub, warn, busy, onSelect, children }: {
  selected: boolean
  icon: React.ReactNode
  name: string
  sub: string
  warn?: string
  busy?: boolean
  onSelect: () => void
  children?: React.ReactNode
}) {
  return (
    <li className={cx(styles.option, selected && styles.selected)}>
      <button type="button" role="radio" aria-checked={selected} className={styles.optionMain} onClick={() => !selected && onSelect()}>
        <span className={styles.optionIcon} aria-hidden="true">{icon}</span>
        <span className={styles.optionText}>
          <span className={styles.optionName}>{name}</span>
          <span className={styles.optionSub}>{sub}</span>
          {warn ? <span className={styles.optionWarn}><CircleAlert aria-hidden="true" /> {warn}</span> : null}
        </span>
        <span className={styles.optionMark} aria-hidden="true">{busy ? <Spinner size={18} /> : selected ? <Check /> : null}</span>
      </button>
      {children}
    </li>
  )
}

/**
 * The Model list of the connection in use. An agent says which models it has only when it starts, so while it is
 * asked the list waits; an agent that offers no choice keeps its own setting.
 */
function ModelPicker({ connection: c, list, disabled, onPick }: { connection: AiConnection; list: ModelList | undefined; disabled: boolean; onPick: (o: ModelOption) => void }) {
  const agent = c.kind === 'agent'
  if (agent && (list === undefined || list === 'loading')) {
    return <p className={styles.loading} role="status"><Spinner size={16} /> Asking {c.label} which models it has…</p>
  }
  const choices = modelChoices(c, Array.isArray(list) ? list : [])
  if (agent && !choices.length) return list === 'failed' ? null : <p className={styles.note}>Uses this agent’s configured model.</p>
  return (
    <label className={styles.modelRow}>
      <span>Model</span>
      <select
        className={styles.select}
        value={c.model ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const picked = choices.find((o) => o.id === e.currentTarget.value)
          if (picked) onPick(picked)
        }}
      >
        {!c.model ? <option value="" disabled>Pick a model</option> : null}
        {choices.map((o) => <option key={o.id} value={o.id}>{optionLabel(o)}</option>)}
      </select>
    </label>
  )
}

function TestResult({ test }: { test: ConnectionTest }) {
  const line = testLine(test)
  return <p className={cx(styles.test, styles[line.tone])} role="status">{line.text}</p>
}

function Picker({ presets, agents, onPick }: { presets: AiPreset[]; agents: DetectedAgent[]; onPick: (v: View) => void }) {
  const keys = useMemo(() => presets.filter((p) => p.group === 'key'), [presets])
  const local = useMemo(() => presets.filter((p) => p.group === 'local'), [presets])
  return (
    <div className={styles.picker}>
      <section aria-labelledby="ai-pick-agents">
        <h3 id="ai-pick-agents" className={styles.groupTitle}>Agents you are signed in to</h3>
        <p className={styles.groupNote}>No key needed. FundBun starts the agent on this computer and it uses your own plan.</p>
        <ul className={styles.rows}>
          {agents.map((a) => (
            <li key={a.id}>
              <button type="button" className={styles.row} onClick={() => onPick({ name: 'agent', agent: a })}>
                <span className={styles.rowIcon} aria-hidden="true"><Bot /></span>
                <span className={styles.rowText}><span className={styles.rowName}>{a.name}</span><span className={styles.rowSub}>{a.vendor}</span></span>
                <Badge variant={a.installed ? 'under' : 'neutral'} size="sm">{a.installed ? 'Found' : 'Not found'}</Badge>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={styles.row} onClick={() => onPick({ name: 'command' })}>
              <span className={styles.rowIcon} aria-hidden="true"><Bot /></span>
              <span className={styles.rowText}><span className={styles.rowName}>Another agent</span><span className={styles.rowSub}>Any command that speaks ACP</span></span>
            </button>
          </li>
        </ul>
      </section>
      <section aria-labelledby="ai-pick-keys">
        <h3 id="ai-pick-keys" className={styles.groupTitle}>With your own key</h3>
        <p className={styles.groupNote}>You pay the provider directly. The key stays on this computer.</p>
        <ul className={styles.rows}>
          {keys.map((p) => <PresetRow key={p.id} preset={p} icon={<KeyRound />} onPick={onPick} />)}
        </ul>
      </section>
      <section aria-labelledby="ai-pick-local">
        <h3 id="ai-pick-local" className={styles.groupTitle}>A model on this computer</h3>
        <p className={styles.groupNote}>Nothing is sent anywhere. Slower, and it needs a model that can call tools.</p>
        <ul className={styles.rows}>
          {local.map((p) => <PresetRow key={p.id} preset={p} icon={<Laptop />} onPick={onPick} />)}
        </ul>
      </section>
    </div>
  )
}

function PresetRow({ preset, icon, onPick }: { preset: AiPreset; icon: React.ReactNode; onPick: (v: View) => void }) {
  return (
    <li>
      <button type="button" className={styles.row} onClick={() => onPick({ name: 'key', preset })}>
        <span className={styles.rowIcon} aria-hidden="true">{icon}</span>
        <span className={styles.rowText}><span className={styles.rowName}>{preset.name}</span><span className={styles.rowSub}>{preset.vendor}</span></span>
      </button>
    </li>
  )
}

function Sent({ local }: { local: boolean }) {
  return local ? (
    <Callout tone="safe" title="Stays on this computer">Your question and the figures Bun needs go to the model running here. Nothing is sent to a company.</Callout>
  ) : (
    <Callout tone="info" title="What is sent">
      Your question and the figures Bun needs to answer it go to this provider, under your own account with them. Names, account numbers and card numbers are masked first. By connecting you agree to that; you can switch back to the built-in engine at any time.
    </Callout>
  )
}

function KeyForm({ preset, onSubmit }: { preset: AiPreset; onSubmit: (input: { presetId: string; apiKey?: string; baseUrl?: string; model?: string; label?: string }) => Promise<string | null> }) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const custom = !preset.baseUrl && preset.kind === 'openai_compat'
  const local = preset.group === 'local'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const err = await onSubmit({ presetId: preset.id, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(custom ? { baseUrl: baseUrl.trim() } : {}), ...(model.trim() ? { model: model.trim() } : {}) })
    setBusy(false)
    if (err) setError(err)
  }

  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)}>
      <p className={styles.note}>{preset.note}{preset.keyUrl ? <> {local ? 'Get it at' : 'Get a key at'} <span className={styles.mono}>{preset.keyUrl.replace(/^https?:\/\//, '')}</span>.</> : null}</p>
      {custom ? (
        <TextField label="Address" placeholder="https://…/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.currentTarget.value)} autoComplete="off" spellCheck={false} required hint="The part before /chat/completions." />
      ) : null}
      {preset.needsKey || custom ? (
        <TextField label={preset.needsKey ? 'API key' : 'API key (if it needs one)'} type="password" value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} autoComplete="off" spellCheck={false} required={preset.needsKey} />
      ) : null}
      <TextField label="Model (optional)" placeholder={preset.defaultModel ?? 'Leave empty to pick from its list'} value={model} onChange={(e) => setModel(e.currentTarget.value)} autoComplete="off" spellCheck={false} />
      <Sent local={local} />
      {error ? <p className={cx(styles.test, styles.bad)} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" fullWidth loading={busy}>Connect {preset.name}</Button>
    </form>
  )
}

function AgentConfirm({ agent, onConnect }: { agent: DetectedAgent; onConnect: () => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const runs = agent.launch.via === 'npx' ? `npx -y ${agent.launch.package}` : [agent.bin, ...agent.launch.args].join(' ')
  return (
    <div className={styles.form}>
      <p className={styles.note}>{agent.note} FundBun does not see your password or your plan: the agent keeps its own sign-in.</p>
      {!agent.installed ? (
        <Callout tone="warn" title={`${agent.name} was not found on this computer`}>
          Install it and sign in first (<span className={styles.mono}>{agent.login}</span>), then come back.
        </Callout>
      ) : null}
      <dl className={styles.facts}>
        <div><dt>FundBun will run</dt><dd className={styles.mono}>{runs}</dd></div>
        {agent.launch.via === 'npx' ? <div><dt>Note</dt><dd>That is {agent.name}’s ACP adapter, downloaded from npm the first time.</dd></div> : null}
        <div><dt>Where</dt><dd>It starts in FundBun’s own folder. It is not sandboxed by FundBun: it can only run commands or change files after you say yes.</dd></div>
        <div><dt>What it gets</dt><dd>FundBun’s tools, through the same rules as any model. FundBun switches it to ask first; an agent that cannot be switched is not used.</dd></div>
      </dl>
      <Sent local={false} />
      {error ? <p className={cx(styles.test, styles.bad)} role="alert">{error}</p> : null}
      <Button
        variant="primary"
        fullWidth
        loading={busy}
        disabled={!agent.installed}
        onClick={() => {
          setBusy(true)
          setError(null)
          void onConnect().then((err) => {
            setBusy(false)
            if (err) setError(err)
          })
        }}
      >
        Connect {agent.name}
      </Button>
    </div>
  )
}

function CommandForm({ onSubmit }: { onSubmit: (label: string, command: string[]) => Promise<string | null> }) {
  const [label, setLabel] = useState('')
  const [line, setLine] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const command = line.trim().split(/\s+/).filter(Boolean)
    if (!command.length || busy) return
    setBusy(true)
    setError(null)
    const err = await onSubmit(label.trim() || command[0], command)
    setBusy(false)
    if (err) setError(err)
  }
  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)}>
      <p className={styles.note}>Any agent that speaks the Agent Client Protocol (ACP) over its standard input and output. FundBun starts the command as written, without a shell.</p>
      <TextField label="Name" placeholder="My agent" value={label} onChange={(e) => setLabel(e.currentTarget.value)} autoComplete="off" />
      <TextField label="Command" placeholder="my-agent --acp" value={line} onChange={(e) => setLine(e.currentTarget.value)} autoComplete="off" spellCheck={false} required hint="The program and its arguments, separated by spaces." />
      <Sent local={false} />
      {error ? <p className={cx(styles.test, styles.bad)} role="alert">{error}</p> : null}
      <Button type="submit" variant="primary" fullWidth loading={busy}>Connect</Button>
    </form>
  )
}
