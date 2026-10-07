import type { ActionPreview, ToolCall } from '../types'
import type { AgentHost, ToolOutcome } from './host'

/** Execute a tool call that the policy engine already allowed / the user approved. Never call without the gate. */
export function executeTool(call: ToolCall, host: AgentHost): ToolOutcome {
  throw new Error('TODO executeTool ' + call.tool + typeof host)
}

/** Structured, code-built preview of what a call will do (never LLM prose). */
export function previewTool(call: ToolCall, host: AgentHost): ActionPreview {
  throw new Error('TODO previewTool ' + call.tool + typeof host)
}
