import { z } from 'zod'
import type { LlmRequest } from '../src/core/agent/llm'

export const LIMITS = {
  bodyBytes: 256 * 1024,
  systemChars: 20_000,
  messages: 40,
  blocksPerMessage: 64,
  tools: 40,
  maxTokens: 2048,
  defaultMaxTokens: 1024,
} as const

const toolName = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'tool names are 1–64 chars of [a-zA-Z0-9_-]')
const id = z.string().min(1).max(128)

const textBlock = z.strictObject({ type: z.literal('text'), text: z.string() })
const toolUseBlock = z.strictObject({ type: z.literal('tool_use'), id, name: toolName, input: z.record(z.string(), z.unknown()) })
const toolResultBlock = z.strictObject({ type: z.literal('tool_result'), tool_use_id: id, content: z.string(), is_error: z.boolean().optional() })
const block = z.discriminatedUnion('type', [textBlock, toolUseBlock, toolResultBlock])

const message = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(block).min(1).max(LIMITS.blocksPerMessage)]),
})

const toolDef = z.strictObject({
  name: toolName,
  description: z.string().max(4000),
  input_schema: z.looseObject({ type: z.literal('object') }),
})

/** Strict: unknown keys are rejected so provider-specific parameters cannot be smuggled through. */
export const llmRequestSchema = z
  .strictObject({
    system: z.string().max(LIMITS.systemChars),
    messages: z.array(message).min(1).max(LIMITS.messages),
    tools: z.array(toolDef).max(LIMITS.tools).default([]),
    maxTokens: z.int().min(1).max(LIMITS.maxTokens).optional(),
  })
  .superRefine((req, ctx) => {
    // zod still runs refinements after non-fatal issues such as min(1)
    if (!req.messages.length) return
    if (req.messages[0].role !== 'user') ctx.addIssue({ code: 'custom', path: ['messages', 0, 'role'], message: 'the first message must be from the user' })
    const lastIndex = req.messages.length - 1
    // a trailing assistant turn would be a prefill, which current models reject
    if (req.messages[lastIndex].role !== 'user') ctx.addIssue({ code: 'custom', path: ['messages', lastIndex, 'role'], message: 'the last message must be from the user' })
    req.messages.forEach((m, i) => {
      if (typeof m.content === 'string') return
      const misplaced = m.content.findIndex((b) => (m.role === 'user' ? b.type === 'tool_use' : b.type === 'tool_result'))
      if (misplaced >= 0) ctx.addIssue({ code: 'custom', path: ['messages', i, 'content', misplaced], message: `${m.content[misplaced].type} is not allowed in a ${m.role} message` })
    })
    const names = req.tools.map((t) => t.name)
    const dup = names.find((n, i) => names.indexOf(n) !== i)
    if (dup) ctx.addIssue({ code: 'custom', path: ['tools'], message: `duplicate tool name: ${dup}` })
  })

export type ValidRequest = Required<Pick<LlmRequest, 'system' | 'messages' | 'tools'>> & { maxTokens: number }

export interface ValidationIssue {
  path: string
  message: string
}

export type ParseResult = { ok: true; value: ValidRequest } | { ok: false; issues: ValidationIssue[] }

/** Issues carry paths and rule messages only — never the offending values (they may be personal data). */
export function parseLlmRequest(input: unknown): ParseResult {
  const result = llmRequestSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
    return { ok: false, issues }
  }
  const { system, messages, tools, maxTokens } = result.data
  return { ok: true, value: { system, messages, tools, maxTokens: maxTokens ?? LIMITS.defaultMaxTokens } }
}
