const express = require("express");
const http = require("http");
const crypto = require("crypto");
const config = require("./config");

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: "50mb" }));

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Auth middleware
function authMiddleware(req, res, next) {
  if (!config.auth.enabled) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token !== config.auth.token) {
    return res.status(401).json({ error: { message: "Invalid token", type: "authentication_error" } });
  }
  next();
}

function generateId() {
  return crypto.randomUUID();
}

function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Build the Z.AI request headers
function zaiHeaders() {
  return {
    "Authorization": `Bearer ${config.zai.bearerToken}`,
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Accept-Language": "en-US",
    "X-FE-Version": "prod-fe-1.0.242",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36",
  };
}

// Step 1: Create a new chat, returns chat_id
async function createChat(model, userMessageId, userContent) {
  const timestamp = Date.now();
  const body = {
    chat: {
      id: "",
      title: "New Chat",
      models: [model],
      params: {},
      history: {
        messages: {
          [userMessageId]: {
            id: userMessageId,
            parentId: null,
            childrenIds: [],
            role: "user",
            content: userContent,
            timestamp: Math.floor(timestamp / 1000),
            models: [model],
          },
        },
        currentId: userMessageId,
      },
      tags: [],
      flags: [],
      features: [{ type: "tool_selector", server: "tool_selector_h", status: "hidden" }],
      mcp_servers: [],
      enable_thinking: config.zai.enableThinking,
      auto_web_search: false,
      message_version: 1,
      extra: {},
      timestamp,
    },
  };

  const resp = await fetch("https://chat.z.ai/api/v1/chats/new", {
    method: "POST",
    headers: zaiHeaders(),
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to create chat: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  return data.id; // chat_id
}

// Step 2: Stream completion, returns full response text
async function streamCompletion(chatId, model, messages, onChunk) {
  const timestamp = Date.now();
  const userMessageId = generateId();
  const completionId = generateId();

  // Build messages array - extract last user message for signature_prompt
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
  const signaturePrompt = lastUserMsg?.content || "";

  // Build query params (Z.AI tracks these but they don't affect auth)
  const params = new URLSearchParams({
    timestamp: timestamp.toString(),
    requestId: generateId(),
    user_id: config.zai.userId,
    version: "0.0.1",
    platform: "web",
    token: config.zai.bearerToken,
  });

  const body = {
    stream: true,
    model,
    messages,
    signature_prompt: signaturePrompt,
    params: {},
    extra: {},
    features: {
      image_generation: false,
      web_search: false,
      auto_web_search: false,
      preview_mode: true,
      flags: [],
      enable_thinking: config.zai.enableThinking,
    },
    variables: {
      "{{CURRENT_DATETIME}}": new Date().toISOString().replace("T", " ").substring(0, 19),
      "{{CURRENT_DATE}}": new Date().toISOString().substring(0, 10),
    },
    chat_id: chatId,
    id: completionId,
    current_user_message_id: userMessageId,
    current_user_message_parent_id: null,
    background_tasks: { title_generation: true, tags_generation: false },
  };

  const resp = await fetch(`https://chat.z.ai/api/v2/chat/completions?${params}`, {
    method: "POST",
    headers: { ...zaiHeaders(), Accept: "text/event-stream" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Completion failed: ${resp.status} ${text}`);
  }

  // Parse SSE stream
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;

      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }

      const phase = parsed?.data?.phase;
      const delta = parsed?.data?.delta_content || "";

      // Skip thinking phase entirely
      if (phase === "thinking") continue;

      if (delta) {
        fullText += delta;
        if (onChunk) onChunk(delta);
      }
    }
  }

  return fullText;
}

// Convert OpenAI messages to Z.AI format (just pass through, same structure)
function prepareMessages(messages) {
  return messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : m.content.map(p => p.text || "").join(""),
    }));
}

// ============== ROUTES ==============

app.get("/", (req, res) => {
  res.json({
    status: "Z.AI Direct API Proxy",
    model: config.zai.model,
    endpoints: ["/v1/models", "/v1/chat/completions"],
  });
});

app.get("/v1/models", authMiddleware, (req, res) => {
  res.json({
    object: "list",
    data: config.knownModels.map(m => ({
      id: m,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "z-ai",
    })),
  });
});

app.post("/v1/chat/completions", authMiddleware, async (req, res) => {
  const { model, messages, stream = false } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: { message: "messages required", type: "invalid_request_error" } });
  }

  if (!config.zai.bearerToken) {
    return res.status(500).json({ error: { message: "ZAI_BEARER_TOKEN not configured", type: "configuration_error" } });
  }

  const useModel = model || config.zai.model;
  const requestId = generateId();
  const zaiMessages = prepareMessages(messages);
  const lastUserContent = [...zaiMessages].reverse().find(m => m.role === "user")?.content || "Hello";

  try {
    // Create a fresh chat for every request
    const chatId = await createChat(useModel, generateId(), lastUserContent);

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      let fullText = "";

      await streamCompletion(chatId, useModel, zaiMessages, (delta) => {
        fullText += delta;
        const chunk = {
          id: `chatcmpl-${requestId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: useModel,
          choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });

      const finalChunk = {
        id: `chatcmpl-${requestId}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: useModel,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();

    } else {
      const text = await streamCompletion(chatId, useModel, zaiMessages, null);

      res.json({
        id: `chatcmpl-${requestId}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: useModel,
        choices: [{
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        }],
        usage: {
          prompt_tokens: estimateTokens(zaiMessages.map(m => m.content).join(" ")),
          completion_tokens: estimateTokens(text),
          total_tokens: estimateTokens(zaiMessages.map(m => m.content).join(" ")) + estimateTokens(text),
        },
      });
    }

  } catch (err) {
    console.error("[API] Error:", err.message);
    if (stream) {
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: { message: err.message, type: "api_error" } });
    }
  }
});

// Legacy endpoint
app.post("/prompt", authMiddleware, async (req, res) => {
  const { prompt, model } = req.body;
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  try {
    const chatId = await createChat(model || config.zai.model, generateId(), prompt);
    const text = await streamCompletion(chatId, model || config.zai.model, [{ role: "user", content: prompt }], null);
    res.json({ success: true, response: text });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`
╔══════════════════════════════════════════╗
║       Z.AI Direct API Proxy Started      ║
╠══════════════════════════════════════════╣
║  URL:   http://localhost:${config.server.port}           ║
║  Model: ${config.zai.model.padEnd(32)}║
╠══════════════════════════════════════════╣
║  NO BROWSER NEEDED - Direct API mode     ║
╚══════════════════════════════════════════╝
`);
});
