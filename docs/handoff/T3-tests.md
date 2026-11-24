# T3: Tests for bring your own AI

Already done: `server/ai/store.test.ts`, `server/ai/paths.test.ts`, `src/core/agent/log-spending.test.ts`. Write the rest
beside the code. Pin behaviour, security first. Use `tests/helpers/fake-host.ts` (`fakeHost`, `scriptedLlm`; a test may
assign `host.agent`, `host.llmInfo`, `host.live`), and `server/app.test.ts` for starting a gateway on port 0 and forging
Host/Origin with raw `node:http`. If a test finds a real bug, fix it in a separate commit and say so.

- `server/ai/service.test.ts`: key stored encoded and never in `state()`/`get()`; key required when the preset needs it;
  model list fetched when no model given (401 reported as "did not accept this key"); `checkBaseUrl` (https; http only
  for localhost/127.0.0.1/[::1]; no credentials in URL); first connection active, later ones do not steal it; removing the
  active one moves it; `activeProvider()` null for agents; `test()` tools true/false; wire quirks (DeepSeek
  `thinking:{type:'disabled'}`, Qwen `enable_thinking:false`, OpenAI `max_completion_tokens`, custom none);
  `agentCommand` (npx pinned package, bin + args, missing binary, custom command); max 20 connections.
- `server/ai/routes.test.ts`: without `ai` every `/api/ai/*` and `/api/agent/*` is 404; foreign Origin 403; foreign Host
  403 on `/api/ai/state`, `/api/llm`, `/api/agent/turn`; CRUD happy paths and 404s; 415 for non-JSON; `/api/health`
  shapes; `/api/llm` is 503 with nothing connected even when `opts.provider` is set; failures record `lastError`.
- `server/agents/acp.test.ts` (fake transport): id matching, JSON-RPC errors, notifications, agent-to-client requests,
  non-JSON stdout ignored, close rejects pending, timeouts.
- `server/agents/runtime.test.ts` (scripted fake agent on the `transport` seam): status, text, done; preamble only on the
  first prompt; process reuse; one MCP server `fundbun` with URL and a 48-hex token; `bypassPermissions` switched to
  `default`; `fundbunToolOf` only matches exact `mcp__fundbun__<tool>` with kind other/absent; FundBun tools auto-allowed
  once (never "always"), Bash asks the user, unknown option or null = cancelled; bridge tools/list excludes tier 4;
  tools/call during a turn round-trips, outside a turn fails, wrong token throws, timeout with fake timers; cancel/close.
- `server/agents/routes.test.ts`, `server/agents/mcp-bridge.test.ts` (spawn the .mjs against a node:http server on port 0).
- `src/core/ai/client.test.ts`: `state()` falls back on non-JSON/HTTP error/network error; `turn()` parses NDJSON split
  across chunks, awaits async handlers, ignores unknown types.
- `src/core/agent/agent-engine.test.ts`: mirror `llm-engine.test.ts` (grounded reply with cards and trace; pending
  proposal not claimed as done; tier 4 denied and not stored; invented figure removed; name and card numbers masked in
  what is sent; long paste wrapped as untrusted; agent error falls back on-device; Stop keeps partial text; over 24 tool
  calls denied; `host.live` updates then null; "stop"/override messages and PINs never reach the agent).
- `src/core/agent/open-mode.test.ts`: Markdown answers with code are `rich`, code indentation kept, non-money numbers not
  checked, "you spent ¥31,415.92" still fails; prompts with and without the "Beyond money" section.
- `src/ui/components/ai/Markdown.test.ts`: parser cases; links and images render as text (no `<a>`, no `<img>`); script
  text stays text; `testLine`, `describeConnection`, `answeringLabel`.
