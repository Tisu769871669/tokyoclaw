require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 9070);
const BRIDGE_TOKEN = String(process.env.AGENT_BRIDGE_TOKEN || '').trim();
const OPENCLAW_BIN = String(process.env.OPENCLAW_BIN || 'openclaw').trim();
const DEFAULT_AGENT_ID = String(process.env.DEFAULT_AGENT_ID || 'snowchuang').trim();
const AGENT_TIMEOUT_SECONDS = Number(process.env.AGENT_TIMEOUT_SECONDS || 120);

function buildTraceId() {
  return crypto.randomUUID();
}

function cleanText(value) {
  return String(value || '').trim();
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function requireAuth(req, res) {
  if (!BRIDGE_TOKEN) return true;
  const auth = cleanText(req.headers.authorization);
  if (auth === `Bearer ${BRIDGE_TOKEN}`) return true;
  res.status(401).json({
    ok: false,
    error: 'unauthorized',
    message: 'missing or invalid bearer token',
    trace_id: buildTraceId()
  });
  return false;
}

function validateChatBody(body) {
  const conversationId = cleanText(body?.conversation_id);
  const message = cleanText(body?.message);
  const userId = cleanText(body?.user_id);

  if (!conversationId) return 'conversation_id is required';
  if (!message) return 'message is required';
  if (!userId) return 'user_id is required';
  return '';
}

function normalizeSessionPart(value, maxLen = 80) {
  const normalized = cleanText(value).replace(/[^a-zA-Z0-9:_-]/g, '_');
  if (!normalized) return 'unknown';
  return normalized.slice(0, maxLen);
}

function buildSessionId(agentId, conversationId) {
  return `bridge:${normalizeSessionPart(agentId, 40)}:${normalizeSessionPart(conversationId, 80)}`;
}

function tryParseJson(raw) {
  const text = stripAnsi(raw).trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

function extractReply(payload, fallbackText) {
  if (!payload || typeof payload !== 'object') {
    return cleanText(fallbackText);
  }

  const candidates = [
    payload.reply,
    payload.response,
    payload.content,
    payload.message,
    payload.output_text,
    payload.text,
    payload?.data?.reply,
    payload?.data?.response,
    payload?.data?.content,
    payload?.result?.reply,
    payload?.result?.content
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && cleanText(value)) {
      return cleanText(value);
    }
  }

  return cleanText(fallbackText);
}

function runOpenClawAgent({ agentId, sessionId, message, traceId }) {
  return new Promise((resolve, reject) => {
    const args = [
      'agent',
      '--agent',
      agentId,
      '--session-id',
      sessionId,
      '--message',
      message,
      '--json',
      '--timeout',
      String(AGENT_TIMEOUT_SECONDS)
    ];

    const child = spawn(OPENCLAW_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let finished = false;

    const killTimer = setTimeout(() => {
      if (finished) return;
      child.kill('SIGTERM');
      reject(new Error(`openclaw timed out after ${AGENT_TIMEOUT_SECONDS}s (trace_id=${traceId})`));
    }, Math.max(AGENT_TIMEOUT_SECONDS, 1) * 1000 + 1000);

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', err => {
      clearTimeout(killTimer);
      if (finished) return;
      finished = true;
      reject(err);
    });

    child.on('close', code => {
      clearTimeout(killTimer);
      if (finished) return;
      finished = true;

      const parsed = tryParseJson(stdout);
      const reply = extractReply(parsed, stripAnsi(stdout));

      if (code !== 0) {
        const detail = cleanText(stripAnsi(stderr)) || `openclaw exited with code ${code}`;
        return reject(new Error(detail));
      }

      if (!reply) {
        return reject(new Error('openclaw returned no readable reply'));
      }

      resolve({
        reply,
        raw: parsed || stripAnsi(stdout)
      });
    });
  });
}

async function handleChat(req, res, agentId) {
  if (!requireAuth(req, res)) return;

  const error = validateChatBody(req.body);
  if (error) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_request',
      message: error,
      trace_id: buildTraceId()
    });
  }

  const traceId = buildTraceId();
  const conversationId = cleanText(req.body.conversation_id);
  const userId = cleanText(req.body.user_id);
  const message = cleanText(req.body.message);
  const sessionId = buildSessionId(agentId, conversationId);

  try {
    const result = await runOpenClawAgent({
      agentId,
      sessionId,
      message,
      traceId
    });

    return res.json({
      ok: true,
      agent_id: agentId,
      conversation_id: conversationId,
      user_id: userId,
      reply: result.reply,
      session_id: sessionId,
      trace_id: traceId
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: 'agent_execution_failed',
      message: cleanText(err.message) || 'agent execution failed',
      trace_id: traceId
    });
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    default_agent_id: DEFAULT_AGENT_ID,
    openclaw_bin: OPENCLAW_BIN
  });
});

app.post('/api/agents/chat', async (req, res) => {
  return handleChat(req, res, DEFAULT_AGENT_ID);
});

app.post('/api/agents/:agentId/chat', async (req, res) => {
  const agentId = normalizeSessionPart(req.params.agentId, 40);
  return handleChat(req, res, agentId);
});

app.listen(PORT, () => {
  console.log(`agent-bridge running on :${PORT}`);
});
