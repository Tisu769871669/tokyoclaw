const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const { runAgentPoolBridge } = require('../agent-pool-client');

test('runAgentPoolBridge forwards chat payload to configured pool', async () => {
  let captured = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      captured = {
        method: req.method,
        path: req.url,
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        reply: '来自 worker 的回复',
        session_id: 'bridge_snowchuang_conv-1'
      }));
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const result = await runAgentPoolBridge({
      baseUrl: `http://127.0.0.1:${port}`,
      token: 'pool-token',
      agentId: 'snowchuang',
      conversationId: 'conv-1',
      userId: 'wxid-1',
      message: '用户本轮消息：想咨询衣服',
      messageList: [{ role: 'user', text: '想咨询衣服' }],
      timeoutMs: 1000
    });

    assert.equal(result.reply, '来自 worker 的回复');
    assert.equal(captured.method, 'POST');
    assert.equal(captured.path, '/api/agents/snowchuang/chat');
    assert.equal(captured.authorization, 'Bearer pool-token');
    assert.deepEqual(captured.body, {
      conversationId: 'conv-1',
      userId: 'wxid-1',
      message: '用户本轮消息：想咨询衣服',
      messageList: [{ role: 'user', text: '想咨询衣服' }]
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('runAgentPoolBridge reports upstream errors clearly', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'queue_timeout',
      message: 'pool is busy'
    }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      () => runAgentPoolBridge({
        baseUrl: `http://127.0.0.1:${port}`,
        agentId: 'snowchuang',
        conversationId: 'conv-1',
        message: 'hello',
        timeoutMs: 1000
      }),
      /agent pool bridge failed with 429 queue_timeout: pool is busy/
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
