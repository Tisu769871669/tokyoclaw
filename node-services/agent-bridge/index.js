require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(express.json({ limit: '256kb' }));

const PORT = Number(process.env.PORT || 9070);
const BRIDGE_TOKEN = String(process.env.AGENT_BRIDGE_TOKEN || '').trim();
const OPENCLAW_BIN = String(process.env.OPENCLAW_BIN || 'openclaw').trim();
const DEFAULT_AGENT_ID = String(process.env.DEFAULT_AGENT_ID || 'snowchuang').trim();
const AGENT_TIMEOUT_SECONDS = Number(process.env.AGENT_TIMEOUT_SECONDS || 120);
const KNOWLEDGE_FILE = String(process.env.KNOWLEDGE_FILE || '客服回复优化.txt').trim();
const KB_TOP_K = Number(process.env.KB_TOP_K || 3);
const KB_MIN_SCORE = Number(process.env.KB_MIN_SCORE || 3);

function buildTraceId() {
  return crypto.randomUUID();
}

function cleanText(value) {
  return String(value || '').trim();
}

function resolveKnowledgeFilePath(filePath) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(__dirname, filePath);
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const text = cleanText(value);
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch (_) {
    return value;
  }
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function normalizeLineText(value) {
  return cleanText(value).replace(/\s+/g, ' ');
}

function loadKnowledgeEntries(filePath) {
  if (!filePath) return [];
  const resolved = resolveKnowledgeFilePath(filePath);
  if (!fs.existsSync(resolved)) return [];

  const raw = fs.readFileSync(resolved, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const entries = [];
  let section = '';
  let question = '';
  let answerParts = [];

  function flush() {
    const finalQuestion = normalizeLineText(question);
    const finalAnswer = normalizeLineText(answerParts.join(' '));
    if (finalQuestion && finalAnswer) {
      entries.push({
        section,
        question: finalQuestion,
        answer: finalAnswer
      });
    }
    question = '';
    answerParts = [];
  }

  for (const rawLine of lines) {
    const line = cleanText(rawLine);
    if (!line || /^---+$/.test(line)) continue;

    if (!/^\d+[.、]/.test(line) && /问题/.test(line) && /（\d+[-—]?\d*）/.test(line)) {
      flush();
      section = normalizeLineText(line);
      continue;
    }

    const questionMatch = line.match(/^\d+[.、]\s*(.*)$/);
    if (questionMatch) {
      flush();
      question = questionMatch[1].replace(/^问题[:：]\s*/, '').trim();
      continue;
    }

    const answerMatch = line.match(/^答案[:：]\s*(.*)$/);
    if (answerMatch) {
      answerParts.push(answerMatch[1].trim());
      continue;
    }

    if (question) {
      if (answerParts.length) {
        answerParts.push(line);
      } else {
        question = `${question} ${line}`.trim();
      }
    }
  }

  flush();
  return entries;
}

function tokenizeForSearch(text) {
  const value = String(text || '').toLowerCase();
  const tokens = [];
  const latin = value.match(/[a-z0-9]+/g) || [];
  tokens.push(...latin);

  const hanSeqs = value.match(/[\p{Script=Han}]+/gu) || [];
  for (const seq of hanSeqs) {
    if (seq.length === 1) {
      tokens.push(seq);
      continue;
    }
    tokens.push(seq);
    for (let i = 0; i < seq.length - 1; i += 1) {
      tokens.push(seq.slice(i, i + 2));
    }
  }

  return tokens.filter(Boolean);
}

function scoreKnowledgeEntry(query, entry) {
  const normalizedQuery = normalizeLineText(query);
  if (!normalizedQuery) return 0;

  let score = 0;
  const question = entry.question || '';
  const answer = entry.answer || '';
  const section = entry.section || '';

  if (question.includes(normalizedQuery)) score += 20;
  if (answer.includes(normalizedQuery)) score += 10;

  const queryTokens = tokenizeForSearch(normalizedQuery);
  const questionTokens = new Set(tokenizeForSearch(question));
  const answerTokens = new Set(tokenizeForSearch(answer));
  const sectionTokens = new Set(tokenizeForSearch(section));

  for (const token of queryTokens) {
    if (!token) continue;
    if (questionTokens.has(token)) {
      score += token.length >= 2 ? 4 : 1;
    } else if (answerTokens.has(token)) {
      score += token.length >= 2 ? 2 : 0.5;
    } else if (sectionTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

const knowledgeFilePath = resolveKnowledgeFilePath(KNOWLEDGE_FILE);
const knowledgeEntries = loadKnowledgeEntries(KNOWLEDGE_FILE);

function buildKnowledgeContext(message) {
  if (!knowledgeEntries.length) return '';

  const ranked = knowledgeEntries
    .map(entry => ({
      ...entry,
      score: scoreKnowledgeEntry(message, entry)
    }))
    .filter(entry => entry.score >= KB_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(KB_TOP_K, 1));

  if (!ranked.length) return '';

  return ranked.map((entry, index) => [
    `候选知识 ${index + 1}`,
    `分类: ${entry.section || '未分类'}`,
    `问题: ${entry.question}`,
    `答案: ${entry.answer}`
  ].join('\n')).join('\n\n');
}

function buildRecentConversationContext(messageList, limit = 6) {
  if (!Array.isArray(messageList) || !messageList.length) return '';

  const recent = messageList.slice(-Math.max(limit, 1));
  return recent.map((item, index) => {
    const speaker = item.role === 'assistant' ? '客服' : '客户';
    return `${index + 1}. ${speaker}: ${item.text}`;
  }).join('\n');
}

function composeAgentMessage(message, messageList = []) {
  const knowledgeContext = buildKnowledgeContext(message);
  const recentConversation = buildRecentConversationContext(messageList);

  if (!knowledgeContext && !recentConversation) return message;

  const parts = [
    '你正在服务雪创客户。',
    '不要在回复中提及知识库、资料、上下文、检索、文档等字眼。'
  ];

  if (recentConversation) {
    parts.push(
      '以下是调用方提供的最近几轮聊天记录，请结合它理解上下文：',
      recentConversation
    );
  }

  if (knowledgeContext) {
    parts.push(
      '以下是本轮根据用户问题从雪创知识库检索到的候选信息，仅在相关时使用；如果不相关请忽略。',
      knowledgeContext
    );
  }

  parts.push(`用户本轮消息：${message}`);
  return parts.join('\n\n');
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

function pickMessageText(item) {
  if (!item) return '';
  if (typeof item === 'string') return cleanText(item);

  const candidates = [
    item.text,
    item.content,
    item.message,
    item.body,
    item.question,
    item.query
  ];

  for (const value of candidates) {
    const text = cleanText(value);
    if (text) return text;
  }

  return '';
}

function normalizeRole(rawRole, item) {
  const role = cleanText(rawRole).toLowerCase();
  if (['user', 'customer', 'client', 'visitor', 'human'].includes(role)) return 'user';
  if (['assistant', 'agent', 'bot', 'ai', '客服'].includes(role)) return 'assistant';

  const sender = cleanText(item?.sender || item?.senderId || item?.from || item?.fromUser || item?.from_user);
  if (/客服|assistant|agent|bot|ai/i.test(sender)) return 'assistant';

  return role || 'user';
}

function pickMessageRole(item) {
  const candidates = [
    item?.role,
    item?.senderRole,
    item?.sender_type,
    item?.type
  ];

  for (const value of candidates) {
    const text = cleanText(value).toLowerCase();
    if (text) return normalizeRole(text, item);
  }

  return normalizeRole('', item);
}

function normalizeMessageList(messageList) {
  if (!Array.isArray(messageList)) return [];

  return messageList
    .map(entry => parseMaybeJson(entry))
    .map(entry => {
      const text = pickMessageText(entry);
      if (!text) return null;
      return {
        role: pickMessageRole(entry),
        text
      };
    })
    .filter(Boolean);
}

function extractMessageFromList(messageList) {
  if (!Array.isArray(messageList) || !messageList.length) return '';

  for (let i = messageList.length - 1; i >= 0; i -= 1) {
    const item = messageList[i];
    const role = item.role;
    const text = item.text;
    if (!text) continue;
    if (!role || ['user', 'customer', 'client', 'visitor', 'human'].includes(role)) {
      return text;
    }
  }

  for (let i = messageList.length - 1; i >= 0; i -= 1) {
    const item = messageList[i];
    const text = item.text;
    if (text) return text;
  }

  return '';
}

function normalizeChatBody(body) {
  const rawContent = parseMaybeJson(body?.content);
  const contentText = typeof rawContent === 'string' ? cleanText(rawContent) : '';
  const rawMessageList = parseMaybeJson(
    (rawContent && typeof rawContent === 'object' ? rawContent.messageList : undefined) ?? body?.messageList
  );
  const messageList = normalizeMessageList(rawMessageList);
  const conversationId = cleanText(body?.conversationId || body?.conversation_id);
  const userId = cleanText(body?.userId || body?.user_id || body?.uid);
  const message = cleanText(body?.message || body?.text || body?.query) || contentText || extractMessageFromList(messageList);

  return {
    conversationId,
    userId,
    message,
    content: rawContent,
    messageList
  };
}

function validateChatBody(normalized) {
  if (!normalized.conversationId) return 'conversationId is required';
  if (!normalized.message) return 'message/content.messageList is required';
  return '';
}

function normalizeSessionPart(value, maxLen = 80) {
  const normalized = cleanText(value).replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!normalized) return 'unknown';
  return normalized.slice(0, maxLen);
}

function buildSessionId(agentId, conversationId) {
  return `bridge_${normalizeSessionPart(agentId, 40)}_${normalizeSessionPart(conversationId, 80)}`;
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

  const payloadText = payload?.payloads?.find(item => typeof item?.text === 'string' && cleanText(item.text))?.text;
  if (payloadText) {
    return cleanText(payloadText);
  }

  const nestedPayloadText = payload?.result?.payloads?.find(item => typeof item?.text === 'string' && cleanText(item.text))?.text;
  if (nestedPayloadText) {
    return cleanText(nestedPayloadText);
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

function runOpenClawAgent({ agentId, sessionId, message, messageList, traceId }) {
  return new Promise((resolve, reject) => {
    const finalMessage = composeAgentMessage(message, messageList);
    const args = [
      'agent',
      '--agent',
      agentId,
      '--session-id',
      sessionId,
      '--message',
      finalMessage,
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

  const normalizedBody = normalizeChatBody(req.body || {});
  const error = validateChatBody(normalizedBody);
  if (error) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_request',
      message: error,
      trace_id: buildTraceId()
    });
  }

  const traceId = buildTraceId();
  const conversationId = normalizedBody.conversationId;
  const userId = normalizedBody.userId;
  const message = normalizedBody.message;
  const messageList = normalizedBody.messageList;
  const sessionId = buildSessionId(agentId, conversationId);

  try {
    const result = await runOpenClawAgent({
      agentId,
      sessionId,
      message,
      messageList,
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
    openclaw_bin: OPENCLAW_BIN,
    knowledge_file: knowledgeFilePath,
    knowledge_entries: knowledgeEntries.length
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
