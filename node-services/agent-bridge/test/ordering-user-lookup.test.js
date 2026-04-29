const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildOrderingLookupEnv,
  buildOrderingLookupRequest,
  lookupOrderingUserById,
  resolveOrderingCredentials
} = require('../ordering-user-lookup');

test('resolveOrderingCredentials prefers explicit XCDHT env variables', () => {
  const credentials = resolveOrderingCredentials(
    { tenantId: '125' },
    {
      XCDHT_MCP_KEY: 'direct-key',
      XCDHT_MCP_SECRET: 'direct-secret',
      FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
        125: {
          mcpKey: 'tenant-key',
          mcpSecret: 'tenant-secret'
        }
      })
    }
  );

  assert.deepEqual(credentials, {
    key: 'direct-key',
    secret: 'direct-secret',
    source: 'xcdht_env'
  });
});

test('resolveOrderingCredentials can derive tenant credentials for an order user lookup', () => {
  const credentials = resolveOrderingCredentials(
    { tenantId: '125' },
    {
      FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
        125: {
          mcpKey: 'tenant-key',
          mcpSecret: 'tenant-secret'
        }
      })
    }
  );

  assert.deepEqual(credentials, {
    key: 'tenant-key',
    secret: 'tenant-secret',
    source: 'tenant_credentials'
  });
});

test('resolveOrderingCredentials uses Snowchuang tenant 125 by default', () => {
  const credentials = resolveOrderingCredentials(
    {},
    {
      FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
        125: {
          mcpKey: 'tenant-key',
          mcpSecret: 'tenant-secret'
        }
      })
    }
  );

  assert.deepEqual(credentials, {
    key: 'tenant-key',
    secret: 'tenant-secret',
    source: 'tenant_credentials'
  });
});

test('buildOrderingLookupRequest points at the xuechuang-ordering helper by default', () => {
  const request = buildOrderingLookupRequest('23788', { tenantId: '125' }, {});

  assert.equal(request.command, 'python3');
  assert.deepEqual(request.args.slice(-2), ['--user-id', '23788']);
  assert.equal(path.basename(request.args[0]), 'xcdht_api.py');
});

test('buildOrderingLookupEnv injects credentials without mutating the source env object', () => {
  const env = {
    PATH: 'test-path',
    FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
      125: {
        mcpKey: 'tenant-key',
        mcpSecret: 'tenant-secret'
      }
    })
  };

  const next = buildOrderingLookupEnv({ tenantId: '125' }, env);

  assert.equal(next.XCDHT_MCP_KEY, 'tenant-key');
  assert.equal(next.XCDHT_MCP_SECRET, 'tenant-secret');
  assert.equal(env.XCDHT_MCP_KEY, undefined);
});

test('lookupOrderingUserById returns parsed member profile from helper stdout', async () => {
  const calls = [];
  const profile = await lookupOrderingUserById(
    '23788',
    { tenantId: '125' },
    {
      env: {
        XCDHT_MCP_KEY: 'direct-key',
        XCDHT_MCP_SECRET: 'direct-secret'
      },
      runCommand: async request => {
        calls.push(request);
        return {
          stdout: JSON.stringify({
            id: 23788,
            mobile: '13800000000'
          }),
          stderr: ''
        };
      }
    }
  );

  assert.deepEqual(profile, {
    id: 23788,
    mobile: '13800000000'
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(-1), '23788');
});
