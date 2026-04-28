function cleanText(value) {
  return String(value || '').trim();
}

function normalizeBaseUrl(baseUrl) {
  const text = cleanText(baseUrl).replace(/\/+$/, '');
  if (!text) {
    throw new Error('AGENT_POOL_BRIDGE_URL is required');
  }
  return text;
}

function buildAgentPoolChatUrl(baseUrl, agentId) {
  const safeAgentId = encodeURIComponent(cleanText(agentId) || 'snowchuang');
  return `${normalizeBaseUrl(baseUrl)}/api/agents/${safeAgentId}/chat`;
}

async function readResponsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return { message: text };
  }
}

function extractReply(payload) {
  const candidates = [
    payload?.reply,
    payload?.response,
    payload?.content,
    payload?.message,
    payload?.text,
    payload?.data?.reply,
    payload?.result?.reply,
    payload?.result?.content
  ];

  for (const value of candidates) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

async function runAgentPoolBridge({
  baseUrl,
  token,
  agentId,
  conversationId,
  userId,
  message,
  messageList,
  timeoutMs
}) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is required to call agent pool bridge');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(Number(timeoutMs) || 1000, 1));
  const body = {
    conversationId,
    userId,
    message
  };
  if (Array.isArray(messageList)) {
    body.messageList = messageList;
  }

  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (cleanText(token)) {
      headers.Authorization = `Bearer ${cleanText(token)}`;
    }

    const response = await fetch(buildAgentPoolChatUrl(baseUrl, agentId), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const payload = await readResponsePayload(response);
    if (!response.ok || payload.ok === false) {
      const code = cleanText(payload.error) || 'upstream_error';
      const detail = cleanText(payload.message) || response.statusText || 'agent pool bridge request failed';
      throw new Error(`agent pool bridge failed with ${response.status} ${code}: ${detail}`);
    }

    const reply = extractReply(payload);
    if (!reply) {
      throw new Error('agent pool bridge returned no readable reply');
    }

    return {
      reply,
      raw: payload
    };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`agent pool bridge timed out after ${Math.max(Number(timeoutMs) || 1000, 1)}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  buildAgentPoolChatUrl,
  runAgentPoolBridge
};
