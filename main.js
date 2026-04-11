"use strict";

// ══════════════════════════════════════════════════════════════════════════════
//  Z.AI UNIVERSAL BRIDGE — Full OpenAI + Anthropic API Compatible Server
// ══════════════════════════════════════════════════════════════════════════════

const express = require("express");
const http = require("http");
const crypto = require("crypto");

// ─── CONFIG (inline defaults — override via env or config.js) ────────────────
let config;
try {
  config = require("./config");
} catch {
  config = {
    server: { port: parseInt(process.env.PORT || "3000"), host: "0.0.0.0" },
    auth: { enabled: true, token: process.env.AUTH_TOKEN || "sk-zai-bridge-token" },
  };
}

const app = express();
const server = http.createServer(app);

// ═════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═════════════════════════════════════════════════════════════════════════════

const BASE_URL              = "https://chat.z.ai";
const SALT_KEY              = "key-@@@@)))()((9))-xxxx&&&%%%%%";
const DEFAULT_FE_VERSION    = "prod-fe-1.0.185";
const INCLUDE_CORE_INSTRUCTIONS = false;

// Anthropic ↔ Z.AI model map
const ANTHROPIC_MODEL_MAP = {
  "claude-opus-4-6":             "GLM-5-Turbo",
  "claude-opus-4-5":             "GLM-5-Turbo",
  "claude-opus-3-5":             "GLM-5-Turbo",
  "claude-3-opus-20240229":      "GLM-5-Turbo",
  "claude-3-5-sonnet-20241022":  "glm-5",
  "claude-3-5-sonnet-20240620":  "glm-5",
  "claude-sonnet-4-6":           "glm-5",
  "claude-sonnet-4-5":           "glm-5",
  "claude-haiku-4-5-20251001":   "glm-5",
  "claude-3-haiku-20240307":     "glm-5",
  "claude-3-5-haiku-20241022":   "glm-5",
};

// OpenAI ↔ Z.AI model map
const OPENAI_MODEL_MAP = {
  "gpt-4o":          "glm-5",
  "gpt-4o-mini":     "glm-5",
  "gpt-4-turbo":     "GLM-5-Turbo",
  "gpt-4":           "GLM-5-Turbo",
  "gpt-3.5-turbo":   "glm-5",
  "o1":              "GLM-5-Turbo",
  "o1-mini":         "glm-5",
  "o3-mini":         "glm-5",
};

const KNOWN_MODELS = [
  // Z.AI native
  "glm-4.7", "glm-5", "GLM-5-Turbo", "GLM-5v-Turbo", "z1-mini",
  // Anthropic aliases
  "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307",
  "claude-3-5-haiku-20241022",
  // OpenAI aliases
  "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo",
  "o1", "o1-mini", "o3-mini",
];

const ROO_CLINE_TOOLS = [
  "write_file","read_file","apply_diff","execute_command","list_files","search_files",
  "ask_followup_question","attempt_completion","browser_action","update_todo_list",
  "switch_mode","new_task","fetch_instructions","delete_file","read_multiple_files",
  "write_multiple_files","search_and_replace","write_to_file","read_from_file",
  "list_directory","execute_shell","run_command","create_file","edit_file",
  "replace_in_file","insert_code","delete_code","move_file","copy_file","rename_file",
  "search_code","find_files","grep_search","ask_question","complete_task","finish_task",
  "submit_result","write","read","edit","bash","glob","grep","task","webfetch",
  "todowrite","todoread","skill","Write","Read","Edit","Bash","Glob","Grep","Task",
  "WebFetch","TodoWrite","TodoRead","Skill","AskUserQuestion",
];

const CORE_INSTRUCTIONS = `CRITICAL INSTRUCTIONS (ALWAYS FOLLOW):
1. When using tools, ALWAYS output tool calls in XML format like: <tool_call><function=name><parameter=key>value</parameter></function></tool_call>
   NEVER use JSON or markdown code blocks for tool calls.
2. Follow every instruction in the prompt deeply and thoroughly. Execute tasks completely.
3. When using attempt_completion, ALWAYS use <parameter=result> - NEVER use <parameter=message> or <parameter=summary>.`;

// ═════════════════════════════════════════════════════════════════════════════
//  SESSION STATE
// ═════════════════════════════════════════════════════════════════════════════

const session = {
  token:        "",
  userId:       "",
  userName:     "Guest",
  chatId:       crypto.randomUUID(),
  messages:     [],
  saltKey:      SALT_KEY,
  feVersion:    DEFAULT_FE_VERSION,
  features: {
    webSearch:    false,
    autoWebSearch:false,
    thinking:     false,
    imageGen:     false,
    previewMode:  false,
  },
  initialized:  false,
  initializing: false,
  stats: {
    totalRequests:  0,
    openaiRequests: 0,
    anthropicRequests: 0,
    errors:         0,
    startTime:      Date.now(),
  },
};

// ═════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ═════════════════════════════════════════════════════════════════════════════

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", [
    "Content-Type", "Authorization", "X-Session-Id", "X-Fresh-Session",
    "anthropic-version", "anthropic-beta", "x-api-key", "OpenAI-Organization",
    "OpenAI-Beta",
  ].join(", "));
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: "50mb" }));

// Request logger
app.use((req, res, next) => {
  if (req.path !== "/status" && req.path !== "/admin/health") {
    const type = req.path.startsWith("/v1/messages") ? "ANT" :
                 req.path.startsWith("/v1/chat")     ? "OAI" : "SYS";
    console.log(`[${type}] ${req.method} ${req.path}`);
  }
  next();
});

function authMiddleware(req, res, next) {
  if (!config.auth.enabled) return next();
  const authHeader  = req.headers.authorization || "";
  const apiKey      = req.headers["x-api-key"] || "";
  const token       = authHeader.replace(/^Bearer\s+/i, "").replace(/^x-api-key\s+/i, "");
  const provided    = token || apiKey;
  if (provided !== config.auth.token) {
    return res.status(401).json({
      type: "error",
      error: { type: "authentication_error", message: "Invalid or missing authentication token" },
    });
  }
  next();
}

// ═════════════════════════════════════════════════════════════════════════════
//  UTILITY HELPERS
// ═════════════════════════════════════════════════════════════════════════════

const generateId = () => crypto.randomBytes(16).toString("hex");
const estimateTokens = (t) => !t ? 0 : Math.ceil((typeof t === "string" ? t : JSON.stringify(t)).length / 4);

function resolveZaiModel(modelName) {
  if (!modelName) return "glm-5";
  const m = modelName.toLowerCase();
  if (ANTHROPIC_MODEL_MAP[modelName]) return ANTHROPIC_MODEL_MAP[modelName];
  if (OPENAI_MODEL_MAP[modelName])    return OPENAI_MODEL_MAP[modelName];
  // fuzzy
  if (m.includes("opus") || m.includes("turbo") || m.includes("o1") || m.includes("gpt-4")) return "GLM-5-Turbo";
  if (m.includes("glm"))  return modelName; // pass through native
  return "glm-5";
}

// ─── Content extraction helpers ──────────────────────────────────────────────

function extractTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(p => {
      if (typeof p === "string") return p;
      if (p.type === "text") return p.text || "";
      if (p.type === "tool_result") {
        const inner = Array.isArray(p.content)
          ? p.content.map(c => c.text || "").join("\n")
          : (p.content || "");
        return `[Tool Result for ${p.tool_use_id}]: ${inner}`;
      }
      if (p.type === "image") return "[IMAGE]";
      return "";
    }).filter(Boolean).join("\n");
  }
  return String(content);
}

// ─── Anthropic messages → flat prompt ────────────────────────────────────────

function anthropicMessagesToPrompt(messages, systemPrompt) {
  let prompt = "";
  if (INCLUDE_CORE_INSTRUCTIONS) prompt += CORE_INSTRUCTIONS + "\n\n";

  if (systemPrompt) {
    const sys = typeof systemPrompt === "string"
      ? systemPrompt
      : Array.isArray(systemPrompt) ? systemPrompt.map(b => b.text || "").join("\n") : String(systemPrompt);
    prompt += `System: ${sys}\n\n`;
  }

  for (const msg of messages) {
    const role = msg.role || "user";
    const content = msg.content;

    if (role === "user") {
      if (Array.isArray(content)) {
        const parts = content.map(p => {
          if (p.type === "text") return p.text;
          if (p.type === "tool_result") {
            const inner = Array.isArray(p.content)
              ? p.content.map(c => c.text || "").join("\n")
              : (p.content || "");
            return `[Tool Result for ${p.tool_use_id}]: ${inner}`;
          }
          if (p.type === "image") return "[User provided an image]";
          return "";
        }).filter(Boolean);
        prompt += `User: ${parts.join("\n")}\n\n`;
      } else {
        prompt += `User: ${extractTextFromContent(content)}\n\n`;
      }
    } else if (role === "assistant") {
      if (Array.isArray(content)) {
        const parts = content.map(p => {
          if (p.type === "text") return p.text;
          if (p.type === "tool_use") return `[Tool Call: ${p.name}(${JSON.stringify(p.input)})]`;
          return "";
        }).filter(Boolean);
        prompt += `Assistant: ${parts.join("\n")}\n\n`;
      } else {
        prompt += `Assistant: ${extractTextFromContent(content)}\n\n`;
      }
    }
  }

  return prompt.trim();
}

// ─── OpenAI messages → flat prompt ───────────────────────────────────────────

function openaiMessagesToPrompt(messages) {
  if (!Array.isArray(messages)) return String(messages);
  let systemMsg = null;
  const convo = [];
  for (const m of messages) {
    if (m.role === "system") systemMsg = extractTextFromContent(m.content);
    else convo.push(m);
  }
  let prompt = "";
  if (INCLUDE_CORE_INSTRUCTIONS) prompt += CORE_INSTRUCTIONS + "\n\n";
  if (systemMsg) prompt += `System: ${systemMsg}\n\n`;
  for (const m of convo) {
    const role = m.role || "user";
    const text = extractTextFromContent(m.content);
    if (role === "user")       prompt += `User: ${text}\n\n`;
    else if (role === "assistant") {
      if (m.tool_calls?.length) {
        const tc = m.tool_calls.map(t => `[Tool Call: ${t.function?.name}(${t.function?.arguments})]`).join("\n");
        prompt += `Assistant: ${text ? text + "\n" : ""}${tc}\n\n`;
      } else {
        prompt += `Assistant: ${text}\n\n`;
      }
    }
    else if (role === "tool") prompt += `Tool Result (${m.tool_call_id}): ${text}\n\n`;
    else if (role === "function") prompt += `Function Result (${m.name}): ${text}\n\n`;
  }
  return prompt.trim();
}

// ═════════════════════════════════════════════════════════════════════════════
//  TOOL CALL PARSING
// ═════════════════════════════════════════════════════════════════════════════

function parseToolCalls(content) {
  if (!content) return [];
  const toolCalls = [];
  let match;

  // Fix malformed <tool_call>name> → <name>
  content = content.replace(/<tool_call>([a-zA-Z_][a-zA-Z0-9_]*)>/gi, "<$1>");

  // ── Markdown JSON blocks ──────────────────────────────────────────────────
  const mdJsonRe = /```(?:json)?\s*\n?\s*(\{[\s\S]*?\})\s*\n?```/gi;
  while ((match = mdJsonRe.exec(content)) !== null) {
    try {
      const d = JSON.parse(match[1]);
      if (d.tool_calls && Array.isArray(d.tool_calls)) {
        for (const tc of d.tool_calls) {
          toolCalls.push({
            id: tc.id || `call_${generateId().substring(0, 24)}`,
            type: "function",
            function: {
              name: tc.function?.name || tc.name,
              arguments: typeof tc.function?.arguments === "string"
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments || tc.arguments || {}),
            },
          });
        }
      } else if (d.name || d.function) {
        toolCalls.push({
          id: `call_${generateId().substring(0, 24)}`,
          type: "function",
          function: {
            name: d.name || d.function,
            arguments: typeof d.arguments === "string" ? d.arguments : JSON.stringify(d.arguments || {}),
          },
        });
      }
    } catch {}
  }

  // ── XML <tool_call><function=name>…</function></tool_call> ────────────────
  const xmlTcRe = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/gi;
  while ((match = xmlTcRe.exec(content)) !== null) {
    const name = match[1].trim();
    const params = parseXmlParams(match[2]);
    toolCalls.push({
      id: `call_${generateId().substring(0, 24)}`,
      type: "function",
      function: { name, arguments: JSON.stringify(params) },
    });
  }

  // ── JSON <tool_call>{…}</tool_call> ──────────────────────────────────────
  const jsonTcRe = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  while ((match = jsonTcRe.exec(content)) !== null) {
    try {
      const d = JSON.parse(match[1]);
      if (d.name || d.function) {
        toolCalls.push({
          id: `call_${generateId().substring(0, 24)}`,
          type: "function",
          function: {
            name: d.name || d.function,
            arguments: typeof d.arguments === "string" ? d.arguments : JSON.stringify(d.arguments || {}),
          },
        });
      }
    } catch {}
  }

  // ── Roo/Cline tool XML tags ───────────────────────────────────────────────
  for (const toolName of ROO_CLINE_TOOLS) {
    const re = new RegExp(`<${toolName}(?:\\s[^>]*)?>([\\s\\S]*?)</${toolName}>`, "gi");
    while ((match = re.exec(content)) !== null) {
      const params = parseXmlParams(match[1]);
      // Fix common alias issues
      normalizeToolParams(toolName.toLowerCase(), params);
      if (Object.keys(params).length > 0 || toolName === "list_files") {
        toolCalls.push({
          id: `call_${generateId().substring(0, 24)}`,
          type: "function",
          function: { name: toolName, arguments: JSON.stringify(params) },
        });
      }
    }
  }

  // ── Unclosed <function=name>…<parameter=x>v ──────────────────────────────
  const unclosedFnRe = /<function=([a-z_]+)>([\s\S]*?)(?=<function=|$)/gi;
  while ((match = unclosedFnRe.exec(content)) !== null) {
    const name = match[1].trim();
    const params = {};
    const pRe = /<parameter=([a-z_]+)>([\s\S]*?)(?=<parameter=|<function=|$)/gi;
    let pm;
    while ((pm = pRe.exec(match[2])) !== null) params[pm[1].trim()] = pm[2].trim();
    if (name === "attempt_completion" && !params.result)
      params.result = params.summary || params.message || "Task completed.";
    delete params.summary; delete params.message;
    if (Object.keys(params).length > 0)
      toolCalls.push({
        id: `call_${generateId().substring(0, 24)}`,
        type: "function",
        function: { name, arguments: JSON.stringify(params) },
      });
  }

  return toolCalls;
}

function parseXmlParams(block) {
  const params = {};
  const re = /<([a-zA-Z_][a-zA-Z0-9_]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    let val = m[2].trim();
    try { val = JSON.parse(val); } catch {}
    params[m[1]] = val;
  }
  return params;
}

function normalizeToolParams(name, params) {
  if (["write","read","edit"].includes(name)) {
    if (params.filePath && !params.file_path)   { params.file_path = params.filePath; delete params.filePath; }
    if (params.path     && !params.file_path)   { params.file_path = params.path;     delete params.path; }
    if (params.file     && !params.file_path)   { params.file_path = params.file;     delete params.file; }
  }
  if (name === "bash" && !params.description && params.command) params.description = "Execute command";
  if (name === "todowrite" && params.todos && typeof params.todos === "string") {
    try { params.todos = JSON.parse(params.todos); } catch {}
  }
  if (name === "attempt_completion" && !params.result) {
    const raw = Object.values(params).join(" ").trim();
    params.result = raw || "Task completed successfully.";
  }
}

function removeToolCallsFromContent(content) {
  if (!content) return "";
  let c = content;
  c = c.replace(/<tool_call>([a-zA-Z_][a-zA-Z0-9_]*)>[\s\S]*?<\/\1>/gi, "");
  c = c.replace(/<tool_call>([a-zA-Z_][a-zA-Z0-9_]*)>[\s\S]*?(?=<tool_call>|$)/gi, "");
  c = c.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  for (const t of ROO_CLINE_TOOLS) {
    c = c.replace(new RegExp(`<${t}(?:\\s[^>]*)?>[\\s\\S]*?</${t}>`, "gi"), "");
  }
  c = c.replace(/<function=[a-z_]+>[\s\S]*$/gi, "");
  c = c.replace(/```(?:json)?\s*\n?\s*\{[\s\S]*?"(?:name|tool_calls)"[\s\S]*?\}\s*\n?```/gi, "");
  c = c.replace(/\n{3,}/g, "\n\n").trim();
  return c;
}

function hasIncompleteToolCall(content) {
  const checks = [
    /<tool_call>(?![\s\S]*<\/tool_call>)/i,
    /<function=[^>]+>(?![\s\S]*<\/function>)/i,
    /<write_file>(?![\s\S]*<\/write_file>)/i,
    /<write_to_file>(?![\s\S]*<\/write_to_file>)/i,
    /<read_file>(?![\s\S]*<\/read_file>)/i,
    /<apply_diff>(?![\s\S]*<\/apply_diff>)/i,
    /<execute_command>(?![\s\S]*<\/execute_command>)/i,
    /<attempt_completion>(?![\s\S]*<\/attempt_completion>)/i,
    /<edit_file>(?![\s\S]*<\/edit_file>)/i,
    /<replace_in_file>(?![\s\S]*<\/replace_in_file>)/i,
    /```(?:json)?\s*\n?\s*\{[^}]*$/i,
    /<write>(?![\s\S]*<\/write>)/i,
    /<read>(?![\s\S]*<\/read>)/i,
    /<edit>(?![\s\S]*<\/edit>)/i,
    /<bash>(?![\s\S]*<\/bash>)/i,
    /<Task>(?![\s\S]*<\/Task>)/,
    /<TodoWrite>(?![\s\S]*<\/TodoWrite>)/,
    /<AskUserQuestion>(?![\s\S]*<\/AskUserQuestion>)/,
  ];
  return checks.some(p => p.test(content));
}

// ═════════════════════════════════════════════════════════════════════════════
//  RESPONSE FORMATTERS — ANTHROPIC
// ═════════════════════════════════════════════════════════════════════════════

function toolCallsToAnthropicBlocks(toolCalls) {
  return toolCalls.map(tc => ({
    type: "tool_use",
    id: tc.id || `toolu_${generateId().substring(0, 24)}`,
    name: tc.function.name,
    input: (() => { try { return JSON.parse(tc.function.arguments); } catch { return { raw: tc.function.arguments }; } })(),
  }));
}

function formatAnthropicResponse(fullContent, model, requestId) {
  const toolCalls   = parseToolCalls(fullContent);
  const cleanText   = toolCalls.length > 0 ? removeToolCallsFromContent(fullContent) : fullContent;
  const contentBlocks = [];
  if (cleanText?.trim()) contentBlocks.push({ type: "text", text: cleanText });
  if (toolCalls.length)  contentBlocks.push(...toolCallsToAnthropicBlocks(toolCalls));
  if (!contentBlocks.length) contentBlocks.push({ type: "text", text: "" });

  return {
    id: `msg_${requestId}`,
    type: "message",
    role: "assistant",
    model: model || "claude-sonnet-4-6",
    content: contentBlocks,
    stop_reason: toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens:  estimateTokens(fullContent),
      output_tokens: estimateTokens(fullContent),
    },
  };
}

function formatAnthropicError(message, type = "api_error") {
  return { type: "error", error: { type, message } };
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────
const sseEvent = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const ssePing  = () => ": ping\n\n";

// ═════════════════════════════════════════════════════════════════════════════
//  RESPONSE FORMATTERS — OPENAI
// ═════════════════════════════════════════════════════════════════════════════

function formatOpenAIResponse(content, model, requestId, stream = false, fullContent = null, finishReason = null) {
  const ts  = Math.floor(Date.now() / 1000);
  const raw = typeof content === "string" ? content : "";

  if (stream) {
    // Final stop chunk: check for tool calls
    if (finishReason) {
      const check = fullContent || raw;
      const tcs   = parseToolCalls(check);
      if (tcs.length > 0) {
        return {
          id: `chatcmpl-${requestId}`, object: "chat.completion.chunk",
          created: ts, model: model || "gpt-4o",
          choices: [{
            index: 0,
            delta: { tool_calls: tcs.map((tc, i) => ({
              index: i, id: tc.id, type: "function",
              function: { name: tc.function.name, arguments: tc.function.arguments },
            }))},
            finish_reason: "tool_calls",
          }],
        };
      }
      return {
        id: `chatcmpl-${requestId}`, object: "chat.completion.chunk",
        created: ts, model: model || "gpt-4o",
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      };
    }
    // Regular delta chunk
    return {
      id: `chatcmpl-${requestId}`, object: "chat.completion.chunk",
      created: ts, model: model || "gpt-4o",
      choices: [{ index: 0, delta: { content: raw }, finish_reason: null }],
    };
  }

  // Non-streaming
  const tcs      = parseToolCalls(raw);
  const cleanMsg = tcs.length > 0 ? removeToolCallsFromContent(raw) : raw;
  const inputTok = estimateTokens(fullContent || "");
  const outTok   = estimateTokens(raw);

  return {
    id: `chatcmpl-${requestId}`, object: "chat.completion",
    created: ts, model: model || "gpt-4o",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: tcs.length > 0 ? (cleanMsg || null) : cleanMsg,
        ...(tcs.length > 0 && { tool_calls: tcs }),
      },
      finish_reason: tcs.length > 0 ? "tool_calls" : "stop",
    }],
    usage: { prompt_tokens: inputTok, completion_tokens: outTok, total_tokens: inputTok + outTok },
  };
}

function formatOpenAIError(message, type = "api_error", status = 500) {
  return { error: { message, type, code: status, param: null } };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Z.AI SESSION MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

async function scrapeFeVersion() {
  try {
    const res  = await fetch(BASE_URL, { signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    const m    = text.match(/prod-fe-\d+\.\d+\.\d+/);
    if (m) { session.feVersion = m[0]; console.log(`[Config] feVersion: ${session.feVersion}`); }
  } catch (e) {
    console.warn(`[Config] Version scrape skipped: ${e.message}`);
  }
}

async function initializeSession(force = false) {
  if (session.initializing && !force) {
    await new Promise(r => {
      const iv = setInterval(() => { if (!session.initializing) { clearInterval(iv); r(); } }, 100);
    });
    return;
  }
  session.initializing = true;
  console.log("[Session] Initializing Z.AI session...");

  try {
    await scrapeFeVersion();
    const headers = { "Origin": BASE_URL, "Referer": `${BASE_URL}/`, "Content-Type": "application/json" };

    // Warm up guest endpoint
    await fetch(`${BASE_URL}/api/v1/auths/guest`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(15_000) }).catch(() => {});

    const authRes  = await fetch(`${BASE_URL}/api/v1/auths/`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!authRes.ok) throw new Error(`Auth fetch failed: ${authRes.status}`);

    const authData = await authRes.json();
    session.token  = authData.token || "";

    if (!session.token) {
      const gr = await fetch(`${BASE_URL}/api/v1/auths/guest`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(15_000) });
      if (gr.ok) session.token = (await gr.json()).token || "";
    }

    if (!session.token) throw new Error("No token from Z.AI");

    // Decode JWT payload
    try {
      const payload   = JSON.parse(Buffer.from(session.token.split(".")[1] + "==", "base64").toString());
      session.userId   = payload.id  || "";
      session.userName = (payload.email || "Guest").split("@")[0];
    } catch {}

    session.initialized = true;
    console.log(`[Session] ✓ Connected as ${session.userName} (${session.userId.substring(0, 8)}...)`);
  } catch (e) {
    console.error("[Session] Init error:", e.message);
    session.initialized = false;
    throw e;
  } finally {
    session.initializing = false;
  }
}

function buildZaiSignature(prompt) {
  const ts        = String(Date.now());
  const requestId = crypto.randomUUID();
  const bucket    = Math.floor(Number(ts) / 300_000);
  const wKey      = crypto.createHmac("sha256", session.saltKey).update(String(bucket)).digest("hex");
  const dict      = { requestId, timestamp: ts, user_id: session.userId };
  const sorted    = Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k},${v}`).join(",");
  const sig       = crypto.createHmac("sha256", wKey).update(`${sorted}|${Buffer.from(prompt.trim()).toString("base64")}|${ts}`).digest("hex");
  const params    = new URLSearchParams({
    timestamp: ts, requestId, user_id: session.userId,
    version: "0.0.1", platform: "web", token: session.token,
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    language: "en-US", screen_resolution: "1920x1080", viewport_size: "1920x1080",
    timezone: "Europe/Paris", timezone_offset: "-60", signature_timestamp: ts,
  });
  return { signature: sig, urlParams: params.toString() };
}

function getContextVars() {
  const now  = new Date();
  const pad  = n => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  return {
    "{{USER_NAME}}": session.userName,
    "{{USER_LOCATION}}": "Unknown",
    "{{CURRENT_DATETIME}}": `${date} ${time}`,
    "{{CURRENT_DATE}}": date,
    "{{CURRENT_TIME}}": time,
    "{{CURRENT_WEEKDAY}}": days[now.getDay()],
    "{{CURRENT_TIMEZONE}}": "Europe/Paris",
    "{{USER_LANGUAGE}}": "en-US",
  };
}

async function* streamFromZAI(prompt, options = {}) {
  const {
    model       = "glm-5",
    webSearch   = session.features.webSearch,
    thinking    = session.features.thinking,
    imageGen    = session.features.imageGen,
    previewMode = session.features.previewMode,
    chatId      = session.chatId,
    messages    = session.messages,
  } = options;

  if (!session.initialized) await initializeSession();

  const { signature, urlParams } = buildZaiSignature(prompt);
  const url = `${BASE_URL}/api/v2/chat/completions?${urlParams}`;

  const msgList = [...messages, { role: "user", content: prompt }];

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Origin":         BASE_URL,
        "Referer":        `${BASE_URL}/`,
        "Authorization":  `Bearer ${session.token}`,
        "X-Signature":    signature,
        "X-FE-Version":   session.feVersion,
        "Content-Type":   "application/json",
      },
      body: JSON.stringify({
        model,
        chat_id:           chatId,
        messages:          msgList,
        signature_prompt:  prompt,
        stream:            true,
        params:            {},
        extra:             {},
        features: {
          image_generation:  imageGen,
          web_search:        webSearch,
          auto_web_search:   webSearch,
          preview_mode:      previewMode,
          flags:             [],
          enable_thinking:   thinking,
        },
        variables:         getContextVars(),
        background_tasks:  { title_generation: true, tags_generation: true },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new Error(`Z.AI connection error: ${e.message}`);
  }

  if (res.status === 401) {
    session.initialized = false;
    await initializeSession(true);
    yield* streamFromZAI(prompt, options);
    return;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Z.AI error ${res.status}: ${errText.substring(0, 200)}`);
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data: ")) continue;
      const raw = trimmed.slice(6);
      if (raw === "[DONE]") return;
      try {
        const json = JSON.parse(raw);
        const text = json.data?.delta_content ?? json.choices?.[0]?.delta?.content ?? null;
        if (text !== null && text !== undefined) yield text;
      } catch {}
    }
  }

  // Flush remaining
  if (buffer.trim().startsWith("data: ")) {
    const raw = buffer.trim().slice(6);
    if (raw !== "[DONE]") {
      try {
        const json = JSON.parse(raw);
        const text = json.data?.delta_content ?? json.choices?.[0]?.delta?.content ?? null;
        if (text !== null && text !== undefined) yield text;
      } catch {}
    }
  }
}

// Convenience: collect full response
async function collectFromZAI(prompt, options = {}) {
  let full = "";
  for await (const chunk of streamFromZAI(prompt, options)) full += chunk;
  return full;
}

// ═════════════════════════════════════════════════════════════════════════════
//  STREAMING UTILITIES
// ═════════════════════════════════════════════════════════════════════════════

function startSSEResponse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const keepAlive = setInterval(() => { try { res.write(ssePing()); } catch { clearInterval(keepAlive); } }, 5_000);
  return () => clearInterval(keepAlive);
}

function parseOptions(body, type = "anthropic") {
  const {
    model, stream = false, temperature, max_tokens, top_p,
    tools, tool_choice, metadata,
    // Z.AI feature hints
    webSearch, deepThink, search,
  } = body;

  return {
    model,
    stream: !!stream,
    temperature: temperature ?? null,
    maxTokens: max_tokens ?? 4096,
    topP: top_p ?? null,
    tools: tools || null,
    toolChoice: tool_choice || null,
    metadata: metadata || null,
    webSearch: webSearch ?? search ?? null,
    deepThink: deepThink ?? null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — ANTHROPIC  /v1/messages
// ═════════════════════════════════════════════════════════════════════════════

app.post("/v1/messages", authMiddleware, async (req, res) => {
  session.stats.totalRequests++;
  session.stats.anthropicRequests++;

  const { model = "claude-sonnet-4-6", messages, system, stream = false, tools, tool_choice } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json(formatAnthropicError("messages is required and must be an array", "invalid_request_error"));
  }

  const freshSession = req.headers["x-fresh-session"] === "true";
  const requestId    = generateId();
  const prompt       = anthropicMessagesToPrompt(messages, system);
  const inputTokens  = estimateTokens(prompt);

  if (freshSession) {
    session.messages = [];
    session.chatId   = crypto.randomUUID();
    console.log("[Session] Fresh session:", session.chatId);
  }

  const zaiOpts = {
    model:       resolveZaiModel(model),
    webSearch:   session.features.webSearch,
    thinking:    session.features.thinking,
    imageGen:    session.features.imageGen,
    previewMode: session.features.previewMode,
    chatId:      session.chatId,
    messages:    session.messages,
  };

  // ── Streaming ──────────────────────────────────────────────────────────────
  if (stream) {
    const stopKeepAlive = startSSEResponse(res);
    const msgId = `msg_${requestId}`;

    // Emit message_start
    res.write(sseEvent("message_start", {
      type: "message_start",
      message: {
        id: msgId, type: "message", role: "assistant", model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    }));

    let fullContent  = "";
    let sentContent  = "";
    let blockOpen    = false;
    const blockIndex = 0;

    try {
      for await (const chunk of streamFromZAI(prompt, zaiOpts)) {
        fullContent += chunk;
        if (hasIncompleteToolCall(fullContent)) continue;

        const delta = fullContent.substring(sentContent.length);
        if (!delta) continue;

        if (!blockOpen) {
          res.write(sseEvent("content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "text", text: "" } }));
          blockOpen = true;
        }
        res.write(sseEvent("content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: delta } }));
        sentContent = fullContent;
      }

      // Flush remainder
      const remaining = fullContent.substring(sentContent.length);
      if (remaining) {
        if (!blockOpen) {
          res.write(sseEvent("content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "text", text: "" } }));
          blockOpen = true;
        }
        res.write(sseEvent("content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: remaining } }));
      }

      if (blockOpen) {
        res.write(sseEvent("content_block_stop", { type: "content_block_stop", index: blockIndex }));
      }

      // Emit tool_use blocks if any
      const toolCalls = parseToolCalls(fullContent);
      let blkIdx = blockIndex + 1;
      for (const tc of toolCallsToAnthropicBlocks(toolCalls)) {
        res.write(sseEvent("content_block_start", { type: "content_block_start", index: blkIdx, content_block: { type: "tool_use", id: tc.id, name: tc.name, input: {} } }));
        res.write(sseEvent("content_block_delta", { type: "content_block_delta", index: blkIdx, delta: { type: "input_json_delta", partial_json: JSON.stringify(tc.input) } }));
        res.write(sseEvent("content_block_stop",  { type: "content_block_stop",  index: blkIdx }));
        blkIdx++;
      }

      const stopReason = toolCalls.length > 0 ? "tool_use" : "end_turn";
      res.write(sseEvent("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: estimateTokens(fullContent) } }));
      res.write(sseEvent("message_stop", { type: "message_stop" }));
      res.write("data: [DONE]\n\n");

      // Persist history
      session.messages.push({ role: "user", content: prompt });
      if (fullContent) session.messages.push({ role: "assistant", content: fullContent });

    } catch (e) {
      session.stats.errors++;
      console.error("[Anthropic/stream] Error:", e.message);
      res.write(sseEvent("error", { type: "error", error: { type: "api_error", message: e.message } }));
      res.write("data: [DONE]\n\n");
    } finally {
      stopKeepAlive();
      res.end();
    }

  // ── Non-streaming ──────────────────────────────────────────────────────────
  } else {
    try {
      const fullContent = await collectFromZAI(prompt, zaiOpts);
      session.messages.push({ role: "user", content: prompt });
      if (fullContent) session.messages.push({ role: "assistant", content: fullContent });
      res.json(formatAnthropicResponse(fullContent, model, requestId));
    } catch (e) {
      session.stats.errors++;
      console.error("[Anthropic/sync] Error:", e.message);
      res.status(e.message.includes("401") ? 401 : 500).json(formatAnthropicError(e.message));
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — OPENAI  /v1/chat/completions
// ═════════════════════════════════════════════════════════════════════════════

app.post("/v1/chat/completions", authMiddleware, async (req, res) => {
  session.stats.totalRequests++;
  session.stats.openaiRequests++;

  const { model = "gpt-4o", messages, stream = false, functions, function_call, tools, tool_choice } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json(formatOpenAIError("messages is required", "invalid_request_error", 400));
  }

  const freshSession = req.headers["x-fresh-session"] === "true";
  const requestId    = generateId();
  const prompt       = openaiMessagesToPrompt(messages);

  if (freshSession) {
    session.messages = [];
    session.chatId   = crypto.randomUUID();
  }

  const zaiOpts = {
    model:       resolveZaiModel(model),
    webSearch:   req.body.webSearch ?? req.body.search ?? session.features.webSearch,
    thinking:    req.body.deepThink ?? session.features.thinking,
    imageGen:    session.features.imageGen,
    previewMode: session.features.previewMode,
    chatId:      session.chatId,
    messages:    session.messages,
  };

  // ── Streaming ──────────────────────────────────────────────────────────────
  if (stream) {
    const stopKeepAlive = startSSEResponse(res);

    // Initial role delta (OpenAI convention)
    res.write(`data: ${JSON.stringify({
      id: `chatcmpl-${requestId}`, object: "chat.completion.chunk",
      created: Math.floor(Date.now()/1000), model,
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
    })}\n\n`);

    let fullContent = "";
    let sentContent = "";

    try {
      for await (const chunk of streamFromZAI(prompt, zaiOpts)) {
        fullContent += chunk;
        if (hasIncompleteToolCall(fullContent)) continue;
        const delta = fullContent.substring(sentContent.length);
        if (!delta) continue;
        sentContent = fullContent;
        res.write(`data: ${JSON.stringify(formatOpenAIResponse(delta, model, requestId, true))}\n\n`);
      }

      // Flush remainder
      const remaining = fullContent.substring(sentContent.length);
      if (remaining) res.write(`data: ${JSON.stringify(formatOpenAIResponse(remaining, model, requestId, true))}\n\n`);

      // Final stop chunk
      res.write(`data: ${JSON.stringify(formatOpenAIResponse("", model, requestId, true, fullContent, "stop"))}\n\n`);
      res.write("data: [DONE]\n\n");

      session.messages.push({ role: "user", content: prompt });
      if (fullContent) session.messages.push({ role: "assistant", content: fullContent });

    } catch (e) {
      session.stats.errors++;
      console.error("[OpenAI/stream] Error:", e.message);
      res.write(`data: ${JSON.stringify({ error: { message: e.message, type: "api_error" } })}\n\n`);
      res.write("data: [DONE]\n\n");
    } finally {
      stopKeepAlive();
      res.end();
    }

  // ── Non-streaming ──────────────────────────────────────────────────────────
  } else {
    try {
      const fullContent = await collectFromZAI(prompt, zaiOpts);
      session.messages.push({ role: "user", content: prompt });
      if (fullContent) session.messages.push({ role: "assistant", content: fullContent });
      res.json(formatOpenAIResponse(fullContent, model, requestId, false, prompt));
    } catch (e) {
      session.stats.errors++;
      console.error("[OpenAI/sync] Error:", e.message);
      res.status(e.message.includes("401") ? 401 : 500).json(formatOpenAIError(e.message));
    }
  }
});

// ─── OpenAI legacy function-call compatibility ────────────────────────────────
// POST /v1/chat/completions already handles `functions` / `function_call` since
// they translate identically from the prompt — OpenAI SDK auto-converts them.

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — MODELS
// ═════════════════════════════════════════════════════════════════════════════

function buildModelList(owned_by = "z-ai") {
  const ts = Math.floor(Date.now() / 1000);
  return KNOWN_MODELS.map(id => ({
    id,
    object: "model",
    created: ts,
    owned_by: id.startsWith("claude") ? "anthropic" : id.startsWith("gpt") || id.startsWith("o") ? "openai" : "z-ai",
    display_name: id,
    capabilities: {
      vision: false,
      function_calling: true,
      json_mode: true,
      streaming: true,
    },
  }));
}

app.get("/v1/models", authMiddleware, (req, res) => {
  res.json({ object: "list", data: buildModelList() });
});

app.get("/v1/models/:id", authMiddleware, (req, res) => {
  const model = buildModelList().find(m => m.id === req.params.id);
  if (!model) return res.status(404).json(formatOpenAIError(`Model '${req.params.id}' not found`, "not_found", 404));
  res.json(model);
});

app.get("/models", authMiddleware, (req, res) => {
  res.json({ models: KNOWN_MODELS, current: "glm-5" });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — OPENAI EMBEDDINGS (stub)
// ═════════════════════════════════════════════════════════════════════════════

app.post("/v1/embeddings", authMiddleware, (req, res) => {
  const { input, model = "text-embedding-ada-002" } = req.body;
  const texts = Array.isArray(input) ? input : [input || ""];
  res.json({
    object: "list",
    data: texts.map((t, i) => ({
      object: "embedding", index: i,
      embedding: Array.from({ length: 1536 }, () => Math.random() * 0.01 - 0.005),
    })),
    model,
    usage: { prompt_tokens: texts.reduce((a, t) => a + estimateTokens(t), 0), total_tokens: 0 },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — DIRECT PROMPT (legacy)
// ═════════════════════════════════════════════════════════════════════════════

app.post("/prompt", authMiddleware, async (req, res) => {
  session.stats.totalRequests++;
  const { prompt, search, deepThink, webSearch } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const freshSession = req.headers["x-fresh-session"] === "true";
  if (freshSession) { session.messages = []; session.chatId = crypto.randomUUID(); }

  try {
    const full = await collectFromZAI(prompt, {
      webSearch: webSearch ?? search ?? session.features.webSearch,
      thinking:  deepThink ?? session.features.thinking,
    });
    session.messages.push({ role: "user", content: prompt });
    if (full) session.messages.push({ role: "assistant", content: full });
    res.json({ success: true, response: full });
  } catch (e) {
    session.stats.errors++;
    res.status(500).json({ success: false, error: e.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — FEATURE MANAGEMENT
// ═════════════════════════════════════════════════════════════════════════════

app.get("/features", authMiddleware, (req, res) => res.json({ success: true, features: session.features }));

app.post("/features", authMiddleware, (req, res) => {
  const { webSearch, thinking, imageGen, previewMode, autoWebSearch } = req.body;
  if (webSearch     !== undefined) { session.features.webSearch = !!webSearch; session.features.autoWebSearch = !!webSearch; }
  if (autoWebSearch !== undefined) session.features.autoWebSearch = !!autoWebSearch;
  if (thinking      !== undefined) session.features.thinking    = !!thinking;
  if (imageGen      !== undefined) session.features.imageGen    = !!imageGen;
  if (previewMode   !== undefined) session.features.previewMode = !!previewMode;
  console.log("[Features]", session.features);
  res.json({ success: true, features: session.features });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ROUTES — ADMIN
// ═════════════════════════════════════════════════════════════════════════════

app.get("/status", (req, res) => {
  res.json({
    connected:    session.initialized,
    userName:     session.userName,
    userId:       session.userId ? session.userId.substring(0, 8) + "..." : null,
    feVersion:    session.feVersion,
    chatId:       session.chatId,
    messageCount: session.messages.length,
    features:     session.features,
    stats:        session.stats,
    uptime:       Math.floor((Date.now() - session.stats.startTime) / 1000),
    mode:         "direct",
  });
});

app.get("/admin/health", (req, res) => {
  res.status(session.initialized ? 200 : 503).json({ healthy: session.initialized, mode: "direct" });
});

app.get("/admin/stats", (req, res) => {
  res.json({ mode: "direct", stats: session.stats, features: session.features });
});

app.get("/admin/clients", (req, res) => {
  res.json({ clients: session.initialized ? [{ id: "session", status: "idle" }] : [] });
});

app.post("/admin/session/clear", authMiddleware, (req, res) => {
  session.messages = [];
  session.chatId   = crypto.randomUUID();
  console.log("[Session] Cleared. New chatId:", session.chatId);
  res.json({ success: true, chatId: session.chatId });
});

app.post("/admin/session/reinit", authMiddleware, async (req, res) => {
  try {
    session.initialized = false;
    await initializeSession(true);
    res.json({ success: true, userName: session.userName });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post("/admin/clients/:id/clear", authMiddleware, (req, res) => {
  session.messages = [];
  session.chatId   = crypto.randomUUID();
  res.json({ success: true });
});

app.post("/stop", authMiddleware, (req, res) => res.json({ success: true }));
app.get("/inject.js", (req, res) => res.type("application/json").send(JSON.stringify({ mode: "direct" })));

// ═════════════════════════════════════════════════════════════════════════════
//  DASHBOARD HTML
// ═════════════════════════════════════════════════════════════════════════════

app.get("/", (req, res) => {
  const host = req.headers.host || `localhost:${config.server.port}`;
  res.send(getDashboardHTML(host));
});

function getDashboardHTML(host) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Z.AI Universal Bridge</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@400;600;800&display=swap');
  :root{
    --bg:#070d14;--surface:#0d1520;--card:#111d2e;--border:#1e3a5f;
    --accent:#3b82f6;--accent2:#06b6d4;--accent3:#8b5cf6;
    --green:#22c55e;--red:#ef4444;--yellow:#f59e0b;
    --text:#e2e8f0;--muted:#64748b;--mono:'JetBrains Mono',monospace;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Syne',sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:24px}
  h1{font-size:2rem;font-weight:800;background:linear-gradient(135deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .header{display:flex;align-items:center;gap:16px;margin-bottom:8px}
  .subtitle{color:var(--muted);font-family:var(--mono);font-size:.85rem;margin-bottom:24px}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px}
  .badge{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;font-family:var(--mono)}
  .b-green{background:rgba(34,197,94,.15);border:1px solid var(--green);color:var(--green)}
  .b-blue {background:rgba(59,130,246,.15);border:1px solid var(--accent);color:var(--accent)}
  .b-cyan {background:rgba(6,182,212,.15);border:1px solid var(--accent2);color:var(--accent2)}
  .b-purple{background:rgba(139,92,246,.15);border:1px solid var(--accent3);color:var(--accent3)}
  .b-yellow{background:rgba(245,158,11,.15);border:1px solid var(--yellow);color:var(--yellow)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:16px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
  .card h2{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:16px}
  .stat-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stat{background:var(--surface);border-radius:8px;padding:12px;border:1px solid var(--border)}
  .stat .l{font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
  .stat .v{font-size:1.3rem;font-weight:700;font-family:var(--mono);margin-top:4px}
  .v-ok{color:var(--green)} .v-err{color:var(--red)} .v-blue{color:var(--accent)} .v-cyan{color:var(--accent2)}
  .wide{grid-column:1/-1}
  pre,code{font-family:var(--mono);font-size:.8rem}
  .codeblock{background:#030810;border:1px solid var(--border);border-radius:8px;padding:16px;overflow-x:auto;white-space:pre;color:#93c5fd;margin:10px 0;line-height:1.6}
  .ep{display:flex;align-items:flex-start;gap:10px;padding:10px;background:var(--surface);border-radius:8px;margin-bottom:8px;border:1px solid var(--border)}
  .method{padding:3px 8px;border-radius:4px;font-size:.7rem;font-weight:700;font-family:var(--mono);flex-shrink:0;margin-top:2px}
  .get{background:var(--green);color:#000} .post{background:var(--accent);color:#fff}
  .ep-path{font-family:var(--mono);font-size:.85rem;color:var(--text)}
  .ep-desc{font-size:.75rem;color:var(--muted);margin-top:3px}
  .section-label{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--accent3);margin:16px 0 8px}
  .toggle-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .toggle-btn{padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-family:var(--mono);font-size:.75rem;cursor:pointer;transition:.2s}
  .toggle-btn:hover{border-color:var(--accent);color:var(--accent)}
  .toggle-btn.active{background:rgba(59,130,246,.15);border-color:var(--accent);color:var(--accent)}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
  .dot-green{background:var(--green);box-shadow:0 0 6px var(--green)}
  .dot-red{background:var(--red)}
</style>
</head>
<body>
<div class="header"><h1>Z.AI Bridge</h1><span class="dot dot-green" id="statusDot"></span></div>
<div class="subtitle">Universal API Proxy — OpenAI + Anthropic Compatible</div>
<div class="badges">
  <span class="badge b-green">⚡ Direct HTTP</span>
  <span class="badge b-blue">OpenAI compat</span>
  <span class="badge b-cyan">Anthropic compat</span>
  <span class="badge b-purple">Tool use</span>
  <span class="badge b-yellow">Streaming SSE</span>
</div>

<div class="grid">
  <div class="card">
    <h2>Session</h2>
    <div class="stat-row">
      <div class="stat"><div class="l">Status</div><div class="v" id="sStatus">…</div></div>
      <div class="stat"><div class="l">User</div><div class="v v-cyan" style="font-size:.95rem" id="sUser">…</div></div>
      <div class="stat"><div class="l">Messages</div><div class="v v-blue" id="sMsgs">0</div></div>
      <div class="stat"><div class="l">FE Build</div><div class="v" style="font-size:.75rem" id="sVer">…</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Request Stats</h2>
    <div class="stat-row">
      <div class="stat"><div class="l">Total</div><div class="v v-blue" id="stTotal">0</div></div>
      <div class="stat"><div class="l">OpenAI</div><div class="v v-cyan" id="stOAI">0</div></div>
      <div class="stat"><div class="l">Anthropic</div><div class="v" style="color:var(--accent3)" id="stANT">0</div></div>
      <div class="stat"><div class="l">Errors</div><div class="v v-err" id="stErr">0</div></div>
    </div>
  </div>

  <div class="card">
    <h2>Features</h2>
    <div class="stat-row">
      <div class="stat"><div class="l">Web Search</div><div class="v" id="fSearch">OFF</div></div>
      <div class="stat"><div class="l">Thinking</div><div class="v" id="fThink">OFF</div></div>
      <div class="stat"><div class="l">Image Gen</div><div class="v" id="fImage">OFF</div></div>
      <div class="stat"><div class="l">Preview</div><div class="v" id="fPrev">OFF</div></div>
    </div>
    <div class="toggle-row">
      <button class="toggle-btn" onclick="toggleFeature('webSearch')">Web Search</button>
      <button class="toggle-btn" onclick="toggleFeature('thinking')">Thinking</button>
      <button class="toggle-btn" onclick="toggleFeature('imageGen')">Image Gen</button>
    </div>
  </div>

  <div class="card wide">
    <h2>API Endpoints</h2>
    <div class="section-label">Anthropic-Compatible (Claude Code, Cursor, etc.)</div>
    <div class="ep"><span class="method post">POST</span><div><div class="ep-path">/v1/messages</div><div class="ep-desc">Anthropic Messages API — SSE streaming, tool_use blocks, system prompt, vision</div></div></div>
    <div class="ep"><span class="method get">GET</span><div><div class="ep-path">/v1/models</div><div class="ep-desc">Model list — Anthropic + OpenAI + Z.AI IDs unified</div></div></div>

    <div class="section-label">OpenAI-Compatible (Any OpenAI SDK client)</div>
    <div class="ep"><span class="method post">POST</span><div><div class="ep-path">/v1/chat/completions</div><div class="ep-desc">Chat completions — streaming, tool_calls, function_call, JSON mode</div></div></div>
    <div class="ep"><span class="method post">POST</span><div><div class="ep-path">/v1/embeddings</div><div class="ep-desc">Embeddings stub (returns random vectors — for compatibility)</div></div></div>
    <div class="ep"><span class="method get">GET</span><div><div class="ep-path">/v1/models/:id</div><div class="ep-desc">Single model details</div></div></div>

    <div class="section-label">Management</div>
    <div class="ep"><span class="method post">POST</span><div><div class="ep-path">/features</div><div class="ep-desc">Toggle webSearch / thinking / imageGen / previewMode</div></div></div>
    <div class="ep"><span class="method post">POST</span><div><div class="ep-path">/admin/session/clear</div><div class="ep-desc">Clear conversation history</div></div></div>
    <div class="ep"><span class="method post">POST</span><div><div class="ep-path">/admin/session/reinit</div><div class="ep-desc">Re-initialize Z.AI session</div></div></div>
    <div class="ep"><span class="method get">GET</span><div><div class="ep-path">/status</div><div class="ep-desc">Full status JSON</div></div></div>
  </div>

  <div class="card wide">
    <h2>Claude Code Setup</h2>
    <div class="codeblock"># Windows PowerShell
$env:ANTHROPIC_BASE_URL="http://${host}"
$env:ANTHROPIC_AUTH_TOKEN="${config.auth.token}"
$env:ANTHROPIC_API_KEY=""
claude

# Linux / macOS
export ANTHROPIC_BASE_URL="http://${host}"
export ANTHROPIC_AUTH_TOKEN="${config.auth.token}"
export ANTHROPIC_API_KEY=""
claude

# ~/.claude/settings.json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://${host}",
    "ANTHROPIC_AUTH_TOKEN": "${config.auth.token}",
    "ANTHROPIC_API_KEY": ""
  }
}</div>

    <h2 style="margin-top:20px">OpenAI SDK (Python)</h2>
    <div class="codeblock">from openai import OpenAI
client = OpenAI(base_url="http://${host}/v1", api_key="${config.auth.token}")
resp = client.chat.completions.create(
    model="gpt-4o",  # or "claude-sonnet-4-6", "glm-5", etc.
    messages=[{"role":"user","content":"Hello!"}],
    stream=True
)
for chunk in resp:
    print(chunk.choices[0].delta.content or "", end="")</div>

    <h2 style="margin-top:20px">Anthropic SDK (Python)</h2>
    <div class="codeblock">import anthropic
client = anthropic.Anthropic(
    base_url="http://${host}",
    api_key="${config.auth.token}"
)
msg = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=1024,
    messages=[{"role":"user","content":"Hello!"}]
)
print(msg.content[0].text)</div>

    <h2 style="margin-top:20px">cURL — Anthropic</h2>
    <div class="codeblock">curl -X POST http://${host}/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${config.auth.token}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '{"model":"claude-sonnet-4-6","max_tokens":512,"stream":true,"messages":[{"role":"user","content":"Hello"}]}'</div>

    <h2 style="margin-top:20px">cURL — OpenAI</h2>
    <div class="codeblock">curl -X POST http://${host}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.auth.token}" \\
  -d '{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"Hello"}]}'</div>
  </div>
</div>

<script>
  const AUTH = "${config.auth.token}";
  async function poll() {
    try {
      const d = await fetch("/status").then(r=>r.json());
      const ok = d.connected;
      document.getElementById("statusDot").className = ok ? "dot dot-green" : "dot dot-red";
      document.getElementById("sStatus").innerHTML = ok ? '<span class="v-ok">● Online</span>' : '<span class="v-err">○ Offline</span>';
      document.getElementById("sUser").textContent  = d.userName || "-";
      document.getElementById("sMsgs").textContent  = d.messageCount;
      document.getElementById("sVer").textContent   = d.feVersion || "-";
      document.getElementById("stTotal").textContent = d.stats?.totalRequests || 0;
      document.getElementById("stOAI").textContent   = d.stats?.openaiRequests || 0;
      document.getElementById("stANT").textContent   = d.stats?.anthropicRequests || 0;
      document.getElementById("stErr").textContent   = d.stats?.errors || 0;
      const f = d.features || {};
      const fmt = (v) => v ? '<span style="color:var(--green)">ON</span>' : '<span style="color:var(--muted)">OFF</span>';
      document.getElementById("fSearch").innerHTML = fmt(f.webSearch);
      document.getElementById("fThink").innerHTML  = fmt(f.thinking);
      document.getElementById("fImage").innerHTML  = fmt(f.imageGen);
      document.getElementById("fPrev").innerHTML   = fmt(f.previewMode);
      // toggle btn active state
      document.querySelectorAll(".toggle-btn").forEach(b => {
        const key = b.getAttribute("onclick").match(/'([^']+)'/)?.[1];
        if (key) b.classList.toggle("active", !!f[key]);
      });
    } catch(e) { console.error(e); }
  }

  async function toggleFeature(key) {
    const d = await fetch("/status").then(r=>r.json());
    const cur = d.features?.[key] ?? false;
    await fetch("/features", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+AUTH},
      body: JSON.stringify({[key]: !cur})
    });
    poll();
  }

  poll();
  setInterval(poll, 3000);
</script>
</body>
</html>`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  START
// ═════════════════════════════════════════════════════════════════════════════

server.listen(config.server.port, config.server.host, async () => {
  const p = config.server.port;
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         Z.AI UNIVERSAL BRIDGE — v2.0                        ║
╠══════════════════════════════════════════════════════════════╣
║  Dashboard      : http://localhost:${p}                     ║
╠══════════════════════════════════════════════════════════════╣
║  Anthropic API  : http://localhost:${p}/v1/messages         ║
║  OpenAI API     : http://localhost:${p}/v1/chat/completions ║
║  Models         : http://localhost:${p}/v1/models           ║
║  Embeddings     : http://localhost:${p}/v1/embeddings       ║
╠══════════════════════════════════════════════════════════════╣
║  Auth Token     : ${config.auth.token}
╠══════════════════════════════════════════════════════════════╣
║  ANTHROPIC_BASE_URL  = http://localhost:${p}                ║
║  ANTHROPIC_AUTH_TOKEN= ${config.auth.token}
║  OPENAI_BASE_URL     = http://localhost:${p}/v1             ║
╚══════════════════════════════════════════════════════════════╝
`);

  try {
    await initializeSession();
  } catch (e) {
    console.warn("[Startup] Session init deferred — will retry on first request.");
  }
});
