# GLM Bridge — Z.AI Proxy API

An OpenAI- and Anthropic-compatible API proxy for [chat.z.ai](https://chat.z.ai), available in two operational modes.

> **Note:** Function calling and tool calling are not supported by Z.ai. Agentic coding workflows relying on native tool calls may produce unexpected results.

> **Warning:** HTTP 405 errors indicate your IP address has been blocked by Z.ai for excessive use of the web UI through the unofficial API. To avoid this, keep prompt lengths under 60,000 characters and avoid sending bursts of rapid requests.

---

## Modes at a Glance

| Mode | File | Description | Status |
|------|------|-------------|--------|
| ⚡ Direct HTTP | `main.js` | Calls Z.AI's REST API directly via HMAC-signed requests. No browser required. | ✅ Recommended |
| 🌐 Browser Automation | `browser.js` | Connects to a live browser tab via WebSocket injection. Requires an open browser session. | ⚠️ Deprecated |

**Recommendation:** Use `main.js`. It is faster, more stable, and requires no browser setup. `browser.js` is deprecated and will not receive further updates; switch to it only as a last resort.

---

## What's New

- **GLM 5.1** model support added
- **Anthropic API** (`/v1/messages`) endpoint with native SSE streaming
- **Claude Code** integration (no LiteLLM required)
- **Tool call parse toggle** — choose between structured `tool_use` blocks or raw passthrough
- **Core instructions toggle** — optionally inject Roo/Cline XML tool format hints into every prompt
- **Debug mode** — logs the exact request body forwarded to Z.ai

---

## Features

- **OpenAI-Compatible API** — Drop-in replacement for the OpenAI chat completions API
- **Anthropic-Compatible API** — Native `/v1/messages` endpoint for Claude Code and Anthropic SDK
- **Streaming Support** — Real-time SSE streaming for both API formats
- **Tool Call Parsing** — Automatic parsing of Roo Code / Kilo Code XML tool format
- **Session Management** — Fresh session support via the `X-Fresh-Session` header
- **Feature Toggles** — Web search, deep thinking, image generation, and preview mode
- **Auto Session Recovery** — Automatically re-authenticates on token expiry *(Direct mode only)*

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/izaart95-jpg/GLM-Bridge.git
cd GLM-Bridge
npm install
```

### 2. Start the Server

**Direct HTTP mode (recommended):**

```bash
node main.js
```

Server starts at `http://localhost:3001`.

**Browser Automation mode (legacy):**

```bash
node browser.js
```

Then open the browser console on `https://chat.z.ai` and run:

```javascript
const script = document.createElement('script');
script.src = 'http://localhost:3001/inject.js';
document.head.appendChild(script);
```

> Keep the browser tab open and in the foreground while using this mode.

---

## Claude Code Integration

The server exposes a native Anthropic-compatible `/v1/messages` endpoint. Point Claude Code directly at it — no LiteLLM required.

### Windows PowerShell

```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:3001"
$env:ANTHROPIC_AUTH_TOKEN = "Waguri"
$env:ANTHROPIC_API_KEY = ""
claude
```

### Windows CMD

```cmd
set ANTHROPIC_BASE_URL=http://localhost:3001
set ANTHROPIC_AUTH_TOKEN=Waguri
set ANTHROPIC_API_KEY=
claude
```

### Persistent Configuration — `~/.claude/settings.json`

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:3001",
    "ANTHROPIC_AUTH_TOKEN": "Waguri",
    "ANTHROPIC_API_KEY": ""
  }
}
```

### Model Mapping

Claude model names are automatically mapped to their Z.AI equivalents:

| Claude Model | Z.AI Model |
|---|---|
| `claude-opus-*` | `GLM-5-Turbo` |
| `claude-sonnet-*` | `glm-5` |
| `claude-haiku-*` | `glm-5` |

---

## API Reference

### Anthropic-Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/messages` | `POST` | Native Anthropic Messages API — streaming SSE and `tool_use` blocks |
| `/v1/models` | `GET` | List models (returns Anthropic-style model IDs) |

#### Non-Streaming Request

```bash
curl -X POST http://localhost:3001/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: Waguri" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

#### Streaming Request

```bash
curl -X POST http://localhost:3001/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: Waguri" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 500,
    "stream": true,
    "messages": [{"role": "user", "content": "Say hi"}]
  }'
```

#### Supported Request Fields

| Field | Type | Notes |
|-------|------|-------|
| `model` | string | Any Claude model name — mapped to GLM internally |
| `messages` | array | Anthropic messages format (`user` / `assistant` turns) |
| `system` | string \| array | System prompt — string or content block array |
| `stream` | boolean | Enable SSE streaming |
| `max_tokens` | number | Accepted but not forwarded |
| `tools` | array | Tool definitions are injected into the prompt |
| `tool_choice` | object | Accepted, ignored |
| `temperature` | number | Accepted, ignored |

#### Response Format

Non-streaming responses return a standard Anthropic message object with `content` blocks of type `text` and, when detected, `tool_use`. The `stop_reason` is `"tool_use"` when tool calls are present, and `"end_turn"` otherwise.

---

### OpenAI-Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | `GET` | List available models |
| `/v1/chat/completions` | `POST` | Chat completion — streaming and non-streaming |

### Legacy Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/prompt` | `POST` | Simple prompt endpoint |
| `/models` | `GET` | List models (legacy format) |
| `/features` | `POST` | Toggle `webSearch`, `thinking`, `imageGen`, `previewMode` |

### Admin Endpoints

| Endpoint | Method | Description | Mode |
|----------|--------|-------------|------|
| `/status` | `GET` | Session and pool status | Both |
| `/admin/health` | `GET` | Health check | Both |
| `/admin/stats` | `GET` | Usage statistics | Both |
| `/admin/clients` | `GET` | List clients and session info | Both |
| `/admin/session/clear` | `POST` | Clear conversation history and generate a new `chatId` | Direct |
| `/admin/clients/:id/clear` | `POST` | Clear a specific client's chat history | Both |
| `/stop` | `POST` | Stop the current generation | Both |
| `/inject.js` | `GET` | Browser injection script | Browser |

---

## Configuration

Configure the server via environment variables or `config.js`.

### Server & Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `AUTH_TOKEN` | `Waguri` | API authentication token |
| `TIMEOUT` | `120000` | Default request timeout (ms) |

### Behavior Toggles

These constants are defined at the top of `main.js` and can be changed before starting the server:

```js
const PARSE_TOOL_CALLS          = true;   // Parse XML/JSON tool calls into structured blocks
const INCLUDE_CORE_INSTRUCTIONS = false;  // Prepend Roo/Cline XML format hints to every prompt
```

#### `PARSE_TOOL_CALLS`

| Value | Behavior |
|-------|----------|
| `true` *(default)* | XML and JSON tool call syntax in model responses is detected, parsed, and returned as structured `tool_use` content blocks (Anthropic format) or `tool_calls` (OpenAI format). Raw tool syntax is stripped from the `text` block. |
| `false` | The model's raw output is returned as-is inside a single `text` block. Use this if you want to handle tool call parsing yourself. |

#### `INCLUDE_CORE_INSTRUCTIONS`

| Value | Behavior |
|-------|----------|
| `false` *(default)* | Prompts are forwarded to Z.AI without modification. |
| `true` | A block of XML formatting instructions is prepended to every prompt, guiding the model to emit tool calls in the format expected by Roo Code / Kilo Code. Enable this if tool calls are not being emitted correctly. |

### Timeout Configuration

If you experience timeout issues, increase the following values:

```bash
export TIMEOUT=300000                  # 5 minutes
export STREAMING_CHUNK_TIMEOUT=120000  # 2 minutes
```

---

## Usage Examples

### Basic Chat Completion (OpenAI format)

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -d '{
    "model": "glm-4.7",
    "messages": [{"role": "user", "content": "What is 2+2?"}]
  }'
```

### Streaming Response

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -d '{
    "model": "glm-4.7",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a haiku"}]
  }'
```

### With Web Search Enabled

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -d '{
    "model": "glm-4.7",
    "webSearch": true,
    "messages": [{"role": "user", "content": "What is the latest news?"}]
  }'
```

### Fresh Session

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -H "X-Fresh-Session: true" \
  -d '{
    "model": "glm-4.7",
    "messages": [{"role": "user", "content": "Start fresh"}]
  }'
```

### Toggle Features

```bash
curl -X POST http://localhost:3001/features \
  -H "Authorization: Bearer Waguri" \
  -H "Content-Type: application/json" \
  -d '{"webSearch": true, "thinking": true}'
```

### Clear Session History

```bash
curl -X POST http://localhost:3001/admin/session/clear \
  -H "Authorization: Bearer Waguri"
```

### Legacy Prompt Endpoint

```bash
curl http://localhost:3001/prompt \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -d '{
    "prompt": "Hello, how are you?",
    "search": true,
    "deepThink": false
  }'
```

---

## Tool Call Support

When `PARSE_TOOL_CALLS = true` (default), Roo Code / Kilo Code XML tool calls are parsed automatically across both OpenAI and Anthropic endpoint modes.

### Supported Formats

**Generic XML format:**

```xml
<tool_call>
<function=write_to_file>
<parameter=path>test.txt</parameter>
<parameter=content>Hello World</parameter>
</function>
</tool_call>
```

**Roo / Cline style:**

```xml
<write_to_file>
<path>test.txt</path>
<content>Hello World</content>
</write_to_file>
```

### Supported Tools

| Category | Tools |
|----------|-------|
| File Write | `write_file`, `write_to_file`, `create_file` |
| File Read | `read_file`, `read_from_file`, `read_multiple_files` |
| File Edit | `edit_file`, `replace_in_file`, `apply_diff` |
| File Management | `delete_file`, `move_file`, `copy_file`, `rename_file` |
| Directory | `list_files`, `list_directory`, `find_files` |
| Search | `search_files`, `search_code`, `grep_search` |
| Shell | `execute_command`, `run_command`, `execute_shell` |
| Task Flow | `attempt_completion`, `complete_task`, `finish_task` |
| Interaction | `ask_followup_question`, `ask_question` |
| Miscellaneous | `browser_action`, `update_todo_list`, `switch_mode`, `new_task`, `fetch_instructions` |
| OpenCode | `write`, `read`, `edit`, `bash`, `glob`, `grep`, `task`, `webfetch`, `todowrite`, `todoread` |

---

## Roo Code / Kilo Code Integration

Configure your Roo Code or Kilo Code settings as follows:

| Setting | Value |
|---------|-------|
| API Base URL | `http://localhost:3001/v1` |
| API Key | `Waguri` |
| Model | `glm-4.7`, `glm-5`, or `GLM-5-Turbo` |

---

## Available Models

| Model | Description |
|-------|-------------|
| `glm-5` | Default model (Direct mode) |
| `GLM-5-Turbo` | Recommended for complex or long-context tasks |
| `GLM-5v-Turbo` | Vision-capable variant |
| `glm-4.7` | Fast model suited for lightweight tasks |
| `claude-sonnet-4-6` | Alias → `glm-5` (for Claude Code compatibility) |
| `claude-opus-4-6` | Alias → `GLM-5-Turbo` (for Claude Code compatibility) |
| `claude-haiku-4-5-*` | Alias → `glm-5` (for Claude Code compatibility) |

---

## Architecture

### Direct HTTP Mode (`main.js`)

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  API Client     │────▶│  main.js             │────▶│  chat.z.ai      │
│  (Claude Code,  │     │  HMAC-signed HTTP    │     │  REST API       │
│   Roo, curl)    │     │  OpenAI + Anthropic  │     │                 │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
```

### Browser Automation Mode (`browser.js`)

```
┌─────────────┐     ┌──────────────────────┐  WS  ┌─────────────────┐
│  API Client │────▶│  browser.js          │◀────▶│  Browser Tab    │
│  (Roo/curl) │     │  WebSocket pool      │      │  (chat.z.ai)    │
└─────────────┘     └──────────────────────┘      └─────────────────┘
```

---

## File Reference

| File | Description |
|------|-------------|
| `main.js` | Direct HTTP server — no browser required |
| `browser.js` | Browser automation server *(deprecated)* |
| `config.js` | Shared configuration |
| `src/pool.js` | Browser client pool *(Browser mode only)* |
| `src/injection.js` | Browser injection script *(Browser mode only)* |
