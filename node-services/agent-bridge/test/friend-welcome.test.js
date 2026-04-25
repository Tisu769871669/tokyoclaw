const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const {
  buildFriendWelcomeContent,
  buildFriendWelcomeSendRequest,
  handleFriendWelcomePayload,
  parseFriendWelcomeEvent,
  resolveFriendWelcomeCredentials,
  sendFriendWelcomeMessage
} = require('../friend-welcome');

test('parseFriendWelcomeEvent recognizes status 1 friend approval events', () => {
  const result = parseFriendWelcomeEvent({
    status: 1,
    sendId: 'new-user-wxid',
    recvId: 'service-wxid',
    conversationId: 'conv-001',
    tenantId: '125'
  });

  assert.equal(result.isEvent, true);
  assert.deepEqual(result.event, {
    status: '1',
    sendId: 'new-user-wxid',
    recvId: 'service-wxid',
    conversationId: 'conv-001',
    tenantId: '125'
  });
});

test('parseFriendWelcomeEvent accepts lowercase tenantid alias', () => {
  const result = parseFriendWelcomeEvent({
    status: 1,
    sendId: 'new-user-wxid',
    recvId: 'service-wxid',
    conversationId: 'conv-001',
    tenantid: '1948976347957321730'
  });

  assert.equal(result.isEvent, true);
  assert.equal(result.event.tenantId, '1948976347957321730');
});

test('parseFriendWelcomeEvent ignores normal chat payloads', () => {
  const result = parseFriendWelcomeEvent({
    conversationId: 'conv-001',
    content: '你好'
  });

  assert.deepEqual(result, { isEvent: false });
});

test('parseFriendWelcomeEvent reports missing friend approval fields', () => {
  const result = parseFriendWelcomeEvent({
    status: '1',
    sendId: 'new-user-wxid'
  });

  assert.equal(result.isEvent, true);
  assert.deepEqual(result.missing, ['recvId', 'conversationId', 'tenantId']);
});

test('buildFriendWelcomeContent combines fixed text and link', () => {
  const content = buildFriendWelcomeContent({
    FRIEND_WELCOME_TEXT: '欢迎添加雪创客服',
    FRIEND_WELCOME_LINK: 'https://example.test/welcome'
  });

  assert.equal(content, '欢迎添加雪创客服\nhttps://example.test/welcome');
});

test('buildFriendWelcomeSendRequest keeps sendId and recvId from the push payload unchanged', () => {
  const request = buildFriendWelcomeSendRequest(
    {
      sendId: 'new-user-wxid',
      recvId: 'service-wxid',
      tenantId: '125'
    },
    {
      FRIEND_WELCOME_SEND_URL: 'https://lx.metast.cn/prod-api/system/api/im/sendWxIdMesage',
      FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
        125: {
          mcpKey: 'tenant-key-125',
          mcpSecret: 'tenant-secret-125'
        }
      }),
      FRIEND_WELCOME_TEXT: '欢迎添加雪创客服',
      FRIEND_WELCOME_LINK: 'https://example.test/welcome'
    }
  );

  assert.equal(request.url.searchParams.get('sendId'), 'new-user-wxid');
  assert.equal(request.url.searchParams.get('recvId'), 'service-wxid');
  assert.equal(request.url.searchParams.get('tenantId'), '125');
  assert.equal(request.url.searchParams.get('content'), '欢迎添加雪创客服\nhttps://example.test/welcome');
  assert.deepEqual(request.headers, {
    mcpKey: 'tenant-key-125',
    mcpSecret: 'tenant-secret-125'
  });
});

test('resolveFriendWelcomeCredentials falls back to global credentials for unknown tenants', () => {
  const credentials = resolveFriendWelcomeCredentials('missing-tenant', {
    FRIEND_WELCOME_MCP_KEY: 'global-key',
    FRIEND_WELCOME_MCP_SECRET: 'global-secret'
  });

  assert.deepEqual(credentials, {
    mcpKey: 'global-key',
    mcpSecret: 'global-secret'
  });
});

test('sendFriendWelcomeMessage sends the configured GET request', async () => {
  let captured = null;
  const server = http.createServer((req, res) => {
    captured = {
      url: new URL(req.url, 'http://127.0.0.1'),
      headers: req.headers
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const result = await sendFriendWelcomeMessage(
      {
        sendId: 'new-user-wxid',
        recvId: 'service-wxid',
        tenantId: '125'
      },
      {
        FRIEND_WELCOME_SEND_URL: `http://127.0.0.1:${port}/sendWxIdMesage`,
        FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
          125: {
            mcpKey: 'key-1',
            mcpSecret: 'secret-1'
          }
        }),
        FRIEND_WELCOME_TEXT: '欢迎添加雪创客服',
        FRIEND_WELCOME_LINK: 'https://example.test/welcome',
        FRIEND_WELCOME_SEND_TIMEOUT_MS: '1000'
      }
    );

    assert.equal(result.statusCode, 200);
    assert.equal(captured.url.pathname, '/sendWxIdMesage');
    assert.equal(captured.url.searchParams.get('sendId'), 'new-user-wxid');
    assert.equal(captured.url.searchParams.get('recvId'), 'service-wxid');
    assert.equal(captured.url.searchParams.get('tenantId'), '125');
    assert.equal(captured.url.searchParams.get('content'), '欢迎添加雪创客服\nhttps://example.test/welcome');
    assert.equal(captured.headers.mcpkey, 'key-1');
    assert.equal(captured.headers.mcpsecret, 'secret-1');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('handleFriendWelcomePayload handles friend approval without returning reply content', async () => {
  let captured = null;
  const server = http.createServer((req, res) => {
    captured = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200);
    res.end('ok');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const result = await handleFriendWelcomePayload(
      {
        status: '1',
        sendId: 'new-user-wxid',
        recvId: 'service-wxid',
        conversationId: 'conv-001',
        tenantId: '125'
      },
      {
        FRIEND_WELCOME_SEND_URL: `http://127.0.0.1:${port}/sendWxIdMesage`,
        FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
          125: {
            mcpKey: 'key-1',
            mcpSecret: 'secret-1'
          }
        }),
        FRIEND_WELCOME_TEXT: '欢迎添加雪创客服',
        FRIEND_WELCOME_LINK: 'https://example.test/welcome',
        FRIEND_WELCOME_SEND_TIMEOUT_MS: '1000'
      }
    );

    assert.deepEqual(result, { handled: true, statusCode: 204 });
    assert.equal(captured.searchParams.get('sendId'), 'new-user-wxid');
    assert.equal(captured.searchParams.get('recvId'), 'service-wxid');
    assert.equal(captured.searchParams.get('tenantId'), '125');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
