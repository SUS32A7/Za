# Z.AI Proxy API

> OpenAI-compatible API proxy for [chat.z.ai](https://chat.z.ai) — available in two modes.

---

## Overview

| Mode | File | Description | Status |
|------|------|-------------|--------|
| ⚡ **Direct HTTP** | `main.js` | Calls Z.AI's REST API directly using HMAC signatures. No browser required. | ✅ Recommended |
| 🌐 **Browser Automation** | `browser.js` | Connects to a live browser tab via WebSocket injection. Requires browser open. | ⚠️ Deprecated |

> **Recommendation:** Use `main.js`. It's faster, more stable, and requires no browser setup.  
> `browser.js` is deprecated and will not receive further updates. Switch to it only as a fallback if you encounter issues with `main.js`.

---

## What's New

- **GLM 5V Turbo** model added
- **Anthropic API** support added
- **Claude Code** Integration added

---

## Features

- **OpenAI-Compatible API** — Drop-in replacement for the OpenAI API
- **Streaming Support** — Real-time SSE streaming responses
- **Tool Call Parsing** — Full support for Roo Code / Kilo Code XML tool format
- **Session Management** — Fresh session support via `X-Fresh-Session` header
- **Feature Toggles** — Web search, deep thinking, image generation, preview mode
- **Auto Session Recovery** — Re-authenticates automatically on token expiry *(Direct mode)*
- **Client Pool** — Multiple browser clients with LRU / round-robin / random rotation *(Browser mode)*
- **Rate Limit Handling** — Automatic cooldown and recovery *(Browser mode)*

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/izaart95-jpg/GLM-Bridge.git
cd GLM-Bridge
npm install
```

---

### Mode A — Direct HTTP (Recommended)

No browser needed. Authenticates as a guest and calls Z.AI's internal API directly.

```bash
node main.js
```

Server starts on `http://localhost:3001`.

---

### Mode B — Browser Automation (Legacy)

**Requires** a browser tab open at `https://chat.z.ai`.

```bash
node browser.js
```

Then open the browser console on `https://chat.z.ai` and run:

```javascript
const script = document.createElement('script');
script.src = 'http://localhost:3001/inject.js';
document.head.appendChild(script);
```

> ⚠️ **Important:** Keep the browser tab open and in the foreground while using this mode.

---

## Making API Requests

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -d '{"model":"glm-4.7","messages":[{"role":"user","content":"Hello!"}]}'
```

---

## API Reference

### OpenAI-Compatible Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | `GET` | List available models |
| `/v1/chat/completions` | `POST` | Chat completion (streaming / non-streaming) |

### Legacy Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/prompt` | `POST` | Simple prompt endpoint |
| `/models` | `GET` | List models (legacy format) |
| `/features` | `POST` | Toggle `webSearch`, `thinking`, `imageGen`, `previewMode` |

### Admin Endpoints

| Endpoint | Method | Description | Mode |
|----------|--------|-------------|------|
| `/status` | `GET` | Session / pool status | Both |
| `/admin/health` | `GET` | Health check | Both |
| `/admin/stats` | `GET` | Statistics | Both |
| `/admin/clients` | `GET` | List clients / session info | Both |
| `/admin/session/clear` | `POST` | Clear conversation history and generate new `chatId` | Direct |
| `/admin/clients/:id/clear` | `POST` | Clear client chat history | Both |
| `/admin/clients/:id` | `DELETE` | Disconnect a browser client | Browser |
| `/admin/queue` | `GET` | Request queue status | Browser |
| `/stop` | `POST` | Stop current generation | Both |
| `/inject.js` | `GET` | Browser injection script | Browser |

---

## Configuration

Configure via environment variables or `config.js`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `AUTH_TOKEN` | `Waguri` | API authentication token |
| `TIMEOUT` | `120000` | Default request timeout (ms) |
| `ROTATION_STRATEGY` | `lru` | Client rotation strategy: `lru`, `round-robin`, `random` *(Browser mode)* |
| `RATE_LIMIT_COOLDOWN` | `300000` | Rate limit cooldown in ms *(Browser mode)* |
| `QUEUE_MAX_SIZE` | `100` | Max queued requests *(Browser mode)* |
| `QUEUE_MAX_WAIT` | `60000` | Max queue wait time in ms *(Browser mode)* |

### Handling Timeout Errors

If you're experiencing timeout issues, increase these values:

```bash
export TIMEOUT=300000                  # 5 minutes
export STREAMING_CHUNK_TIMEOUT=120000  # 2 minutes
```

---

## Usage Examples

### Basic Chat Completion

```bash
curl http://localhost:3001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer Waguri" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is 2+2?"}
    ]
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

### Fresh Session (Clear History)

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

### Toggle Features (Direct Mode)

```bash
curl -X POST http://localhost:3001/features \
  -H "Authorization: Bearer Waguri" \
  -H "Content-Type: application/json" \
  -d '{"webSearch": true, "thinking": true}'
```

### Clear Session History (Direct Mode)

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

Roo Code / Kilo Code XML tool calls are parsed automatically. Works in both modes.

### Supported Formats

**XML Format (Recommended)**

```xml
<tool_call>
<function=write_to_file>
<parameter=path>test.txt</parameter>
<parameter=content>Hello World</parameter>
</function>
</tool_call>
```

**Roo / Cline Style**

```xml
<write_to_file>
<path>test.txt</path>
<content>Hello World</content>
</write_to_file>
```

### Supported Tools

| Category | Tools |
|----------|-------|
| **File Write** | `write_file`, `write_to_file`, `create_file` |
| **File Read** | `read_file`, `read_from_file`, `read_multiple_files` |
| **File Edit** | `edit_file`, `replace_in_file`, `apply_diff` |
| **File Management** | `delete_file`, `move_file`, `copy_file`, `rename_file` |
| **Directory** | `list_files`, `list_directory`, `find_files` |
| **Search** | `search_files`, `search_code`, `grep_search` |
| **Shell** | `execute_command`, `run_command`, `execute_shell` |
| **Task Flow** | `attempt_completion`, `complete_task`, `finish_task` |
| **Interaction** | `ask_followup_question`, `ask_question` |
| **Misc** | `browser_action`, `update_todo_list`, `switch_mode`, `new_task`, `fetch_instructions` |
| **OpenCode** | `write`, `read`, `edit`, `bash`, `glob`, `grep`, `task`, `webfetch`, `todowrite`, `todoread` |

---

## Roo Code / Kilo Code Integration

In your Roo Code or Kilo Code settings, configure:

| Setting | Value |
|---------|-------|
| **API Base URL** | `http://localhost:3001/v1` |
| **API Key** | `Waguri` |
| **Model** | `glm-4.7`, `z1`, or `z1-mini` |

---

## Models

| Model | Description |
|-------|-------------|
| `glm-4.7` | Default model (Direct mode) |
| `glm-z1` | GLM Z1 — Z.AI main model |
| `glm-z1-mini` | GLM Z1 Mini — Z.AI lightweight model |
| `glm-5v-turbo` | GLM 5V Turbo *(new)* |

---

## Architecture

### Direct HTTP Mode (`main.js`)

```
┌─────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  API Client │────▶│  main.js             │────▶│  chat.z.ai      │
│  (Roo/curl) │     │  HMAC-signed HTTP    │     │  REST API       │
└─────────────┘     └──────────────────────┘     └─────────────────┘
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
