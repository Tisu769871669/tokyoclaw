const http = require('http');
const https = require('https');

const DEFAULT_SEND_URL = 'https://lx.metast.cn/prod-api/system/api/im/sendWxIdMesage';
const DEFAULT_TIMEOUT_MS = 10000;

function cleanText(value) {
  return String(value || '').trim();
}

function parseFriendWelcomeEvent(body) {
  if (!body || typeof body !== 'object') return { isEvent: false };

  const status = cleanText(body.status);
  if (status !== '1') return { isEvent: false };

  const event = {
    status,
    sendId: cleanText(body.sendId),
    recvId: cleanText(body.recvId),
    conversationId: cleanText(body.conversationId || body.conversation_id),
    tenantId: cleanText(body.tenantId || body.tenantid || body.tenant_id)
  };
  const missing = ['sendId', 'recvId', 'conversationId', 'tenantId'].filter(key => !event[key]);

  if (missing.length) {
    return {
      isEvent: true,
      missing,
      event
    };
  }

  return {
    isEvent: true,
    event
  };
}

function buildFriendWelcomeContent(env = process.env) {
  const explicitContent = cleanText(env.FRIEND_WELCOME_CONTENT);
  if (explicitContent) return explicitContent;

  return [
    cleanText(env.FRIEND_WELCOME_TEXT),
    cleanText(env.FRIEND_WELCOME_LINK)
  ].filter(Boolean).join('\n');
}

function normalizeEnvKeyPart(value) {
  return cleanText(value).replace(/[^a-zA-Z0-9_]/g, '_');
}

function parseTenantCredentials(env = process.env) {
  const raw = cleanText(env.FRIEND_WELCOME_TENANT_CREDENTIALS);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    throw new Error('FRIEND_WELCOME_TENANT_CREDENTIALS must be valid JSON');
  }
}

function resolveFriendWelcomeCredentials(tenantId, env = process.env) {
  const normalizedTenantId = cleanText(tenantId);
  const envKeyPart = normalizeEnvKeyPart(normalizedTenantId);
  const tenantCredentials = parseTenantCredentials(env);
  const scopedCredentials = tenantCredentials[normalizedTenantId] || tenantCredentials[envKeyPart] || {};

  return {
    mcpKey: cleanText(
      env[`FRIEND_WELCOME_TENANT_${envKeyPart}_MCP_KEY`] ||
      scopedCredentials.mcpKey ||
      scopedCredentials.mcp_key ||
      env.FRIEND_WELCOME_MCP_KEY
    ),
    mcpSecret: cleanText(
      env[`FRIEND_WELCOME_TENANT_${envKeyPart}_MCP_SECRET`] ||
      scopedCredentials.mcpSecret ||
      scopedCredentials.mcp_secret ||
      env.FRIEND_WELCOME_MCP_SECRET
    )
  };
}

function buildFriendWelcomeSendRequest(event, env = process.env) {
  const sendUrl = cleanText(env.FRIEND_WELCOME_SEND_URL) || DEFAULT_SEND_URL;
  const { mcpKey, mcpSecret } = resolveFriendWelcomeCredentials(event?.tenantId, env);
  const content = buildFriendWelcomeContent(env);

  const missing = [];
  if (!event?.tenantId) missing.push('tenantId');
  if (!mcpKey) missing.push(`mcpKey for tenant ${event?.tenantId || 'unknown'}`);
  if (!mcpSecret) missing.push(`mcpSecret for tenant ${event?.tenantId || 'unknown'}`);
  if (!content) missing.push('FRIEND_WELCOME_CONTENT or FRIEND_WELCOME_TEXT');
  if (!event?.sendId) missing.push('sendId');
  if (!event?.recvId) missing.push('recvId');

  if (missing.length) {
    throw new Error(`friend welcome config missing: ${missing.join(', ')}`);
  }

  const url = new URL(sendUrl);
  url.searchParams.set('sendId', event.sendId);
  url.searchParams.set('recvId', event.recvId);
  url.searchParams.set('tenantId', event.tenantId);
  url.searchParams.set('content', content);

  return {
    url,
    headers: {
      mcpKey,
      mcpSecret
    },
    timeoutMs: Number(env.FRIEND_WELCOME_SEND_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function sendGetRequest({ url, headers, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'http:' ? http : https;
    const request = transport.request(url, { method: 'GET', headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        const result = {
          statusCode: response.statusCode,
          body
        };

        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(result);
          return;
        }

        const error = new Error(`friend welcome send failed with HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        error.body = body;
        reject(error);
      });
    });

    request.setTimeout(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1), () => {
      request.destroy(new Error('friend welcome send timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function sendFriendWelcomeMessage(event, env = process.env) {
  const request = buildFriendWelcomeSendRequest(event, env);
  return sendGetRequest(request);
}

async function handleFriendWelcomePayload(body, env = process.env) {
  const parsed = parseFriendWelcomeEvent(body);
  if (!parsed.isEvent) return { handled: false };

  if (parsed.missing?.length) {
    return {
      handled: true,
      statusCode: 400,
      error: 'invalid_friend_welcome_event',
      message: `missing required fields: ${parsed.missing.join(', ')}`
    };
  }

  await sendFriendWelcomeMessage(parsed.event, env);
  return {
    handled: true,
    statusCode: 204
  };
}

module.exports = {
  buildFriendWelcomeContent,
  buildFriendWelcomeSendRequest,
  handleFriendWelcomePayload,
  parseFriendWelcomeEvent,
  resolveFriendWelcomeCredentials,
  sendFriendWelcomeMessage
};
