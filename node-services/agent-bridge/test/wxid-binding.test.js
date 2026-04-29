const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  bindWxidFromOrderUser,
  extractBindingCandidate,
  extractPhoneFromMemberProfile,
  loadBindingStore,
  runWxidBindingFromPayload
} = require('../wxid-binding');

function tempStoreFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wxid-binding-')), 'bindings.json');
}

test('extractBindingCandidate uses order.userId and conversationId for wxid binding', () => {
  const candidate = extractBindingCandidate({
    conversationId: 'wxid_customer_001',
    tenantId: '125',
    order: {
      id: 90001,
      userId: 23788,
      status: 5
    }
  });

  assert.deepEqual(candidate, {
    wxid: 'wxid_customer_001',
    orderUserId: '23788',
    tenantId: '125',
    conversationId: 'wxid_customer_001'
  });
});

test('extractBindingCandidate prefers explicit orderUserId over generic userId', () => {
  const candidate = extractBindingCandidate({
    sendId: 'wxid_customer_002',
    conversationId: 'conv-002',
    userId: 'wxid_not_order_user',
    orderUserId: '23789'
  });

  assert.equal(candidate.wxid, 'wxid_customer_002');
  assert.equal(candidate.orderUserId, '23789');
  assert.equal(candidate.conversationId, 'conv-002');
});

test('extractPhoneFromMemberProfile reads common Snowchuang phone fields', () => {
  assert.deepEqual(
    extractPhoneFromMemberProfile({
      id: 23788,
      loginMobile: ' 13800000000 '
    }),
    {
      phone: '13800000000',
      field: 'loginMobile'
    }
  );
});

test('bindWxidFromOrderUser queries member profile and persists wxid phone binding', async () => {
  const storeFile = tempStoreFile();
  const lookups = [];

  const result = await bindWxidFromOrderUser(
    {
      conversationId: 'wxid_customer_003',
      tenantId: '125',
      order: {
        userId: 23790
      }
    },
    {
      storeFile,
      lookupUserById: async orderUserId => {
        lookups.push(orderUserId);
        return {
          id: 23790,
          mobile: '13900000000',
          shopTenantId: 125
        };
      },
      now: () => new Date('2026-04-29T03:00:00.000Z')
    }
  );

  assert.equal(result.bound, true);
  assert.equal(result.binding.wxid, 'wxid_customer_003');
  assert.equal(result.binding.orderUserId, '23790');
  assert.equal(result.binding.phone, '13900000000');
  assert.deepEqual(lookups, ['23790']);

  const store = loadBindingStore(storeFile);
  assert.equal(store.byWxid.wxid_customer_003.phone, '13900000000');
  assert.equal(store.byOrderUserId['23790'].wxid, 'wxid_customer_003');
});

test('bindWxidFromOrderUser skips binding when member profile has no phone', async () => {
  const result = await bindWxidFromOrderUser(
    {
      conversationId: 'wxid_customer_004',
      order: {
        userId: 23791
      }
    },
    {
      storeFile: tempStoreFile(),
      lookupUserById: async () => ({ id: 23791 }),
      now: () => new Date('2026-04-29T03:00:00.000Z')
    }
  );

  assert.deepEqual(result, {
    bound: false,
    reason: 'phone_not_found',
    orderUserId: '23791',
    wxid: 'wxid_customer_004'
  });
});

test('runWxidBindingFromPayload does not throw when lookup fails', async () => {
  const warnings = [];
  const result = await runWxidBindingFromPayload(
    {
      conversationId: 'wxid_customer_005',
      order: {
        userId: 23792
      }
    },
    {
      storeFile: tempStoreFile(),
      lookupUserById: async () => {
        throw new Error('lookup unavailable');
      },
      logger: {
        warn: message => warnings.push(message)
      }
    }
  );

  assert.equal(result.bound, false);
  assert.equal(result.reason, 'lookup_failed');
  assert.equal(warnings.length, 1);
});
