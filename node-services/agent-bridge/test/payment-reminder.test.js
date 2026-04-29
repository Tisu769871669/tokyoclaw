const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
  buildPaymentReminderContent,
  buildPaymentReminderSendRequest,
  extractPendingPaymentOrder,
  isPendingPaymentOrder,
  loadReminderStore,
  runPaymentReminderFromPayload
} = require('../payment-reminder');

function tempFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'payment-reminder-')), name);
}

function writeBindingStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      updatedAt: '2026-04-29T04:00:00.000Z',
      byWxid: {
        wxid_customer_001: {
          wxid: 'wxid_customer_001',
          orderUserId: '23788',
          phone: '13800000000',
          tenantId: '125'
        }
      },
      byOrderUserId: {
        23788: {
          wxid: 'wxid_customer_001',
          orderUserId: '23788',
          phone: '13800000000',
          tenantId: '125'
        }
      }
    }),
    'utf8'
  );
}

test('isPendingPaymentOrder recognizes Snowchuang status 5 unpaid orders', () => {
  assert.equal(isPendingPaymentOrder({ status: 5, payStatus: 0 }), true);
  assert.equal(isPendingPaymentOrder({ status: '5', payStatus: false }), true);
  assert.equal(isPendingPaymentOrder({ status: 10, payStatus: 1 }), false);
  assert.equal(isPendingPaymentOrder({ status: 5, payStatus: 1 }), false);
});

test('extractPendingPaymentOrder returns the first pending order from payload', () => {
  const order = extractPendingPaymentOrder({
    orders: [
      { id: 1, userId: 23788, status: 10, payStatus: 1 },
      { id: 2, userId: 23788, status: 5, payStatus: 0 }
    ]
  });

  assert.equal(order.id, 2);
});

test('buildPaymentReminderContent uses order number and amount when present', () => {
  const content = buildPaymentReminderContent({
    no: 'XCDHT20260429001',
    payPrice: 29900
  });

  assert.match(content, /XCDHT20260429001/);
  assert.match(content, /29900/);
});

test('buildPaymentReminderSendRequest targets bound wxid with service recvId', () => {
  const request = buildPaymentReminderSendRequest(
    {
      wxid: 'wxid_customer_001',
      tenantId: '125'
    },
    { no: 'ORDER-1' },
    {
      recvId: 'wxid_service'
    },
    {
      FRIEND_WELCOME_SEND_URL: 'https://example.test/sendWxIdMesage',
      FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
        125: {
          mcpKey: 'tenant-key',
          mcpSecret: 'tenant-secret'
        }
      })
    }
  );

  assert.equal(request.url.searchParams.get('sendId'), 'wxid_customer_001');
  assert.equal(request.url.searchParams.get('recvId'), 'wxid_service');
  assert.equal(request.url.searchParams.get('tenantId'), '125');
  assert.match(request.url.searchParams.get('content'), /ORDER-1/);
  assert.deepEqual(request.headers, {
    mcpKey: 'tenant-key',
    mcpSecret: 'tenant-secret'
  });
});

test('runPaymentReminderFromPayload dry-runs by default and does not call sender', async () => {
  const bindingStoreFile = tempFile('bindings.json');
  const reminderStoreFile = tempFile('reminders.json');
  writeBindingStore(bindingStoreFile);
  let sends = 0;

  const result = await runPaymentReminderFromPayload(
    {
      recvId: 'wxid_service',
      order: {
        id: 90001,
        no: 'ORDER-90001',
        userId: 23788,
        status: 5,
        payStatus: 0
      }
    },
    {
      bindingStoreFile,
      reminderStoreFile,
      sendMessage: async () => {
        sends += 1;
      },
      now: () => new Date('2026-04-29T04:00:00.000Z')
    }
  );

  assert.equal(result.reminded, false);
  assert.equal(result.reason, 'dry_run');
  assert.equal(result.wouldSend, true);
  assert.equal(sends, 0);
});

test('runPaymentReminderFromPayload sends once and skips duplicate within cooldown', async () => {
  const bindingStoreFile = tempFile('bindings.json');
  const reminderStoreFile = tempFile('reminders.json');
  writeBindingStore(bindingStoreFile);
  const sent = [];

  const payload = {
    recvId: 'wxid_service',
    order: {
      id: 90002,
      no: 'ORDER-90002',
      userId: 23788,
      status: 5,
      payStatus: 0
    }
  };

  const options = {
    bindingStoreFile,
    reminderStoreFile,
    sendEnabled: true,
    sendMessage: async request => {
      sent.push(request.url.searchParams.get('sendId'));
      return { statusCode: 200, body: 'ok' };
    },
    env: {
      FRIEND_WELCOME_SEND_URL: 'https://example.test/sendWxIdMesage',
      FRIEND_WELCOME_TENANT_CREDENTIALS: JSON.stringify({
        125: {
          mcpKey: 'tenant-key',
          mcpSecret: 'tenant-secret'
        }
      })
    },
    now: () => new Date('2026-04-29T04:00:00.000Z')
  };

  const first = await runPaymentReminderFromPayload(payload, options);
  const second = await runPaymentReminderFromPayload(payload, options);

  assert.equal(first.reminded, true);
  assert.equal(second.reminded, false);
  assert.equal(second.reason, 'cooldown_active');
  assert.deepEqual(sent, ['wxid_customer_001']);
  assert.equal(loadReminderStore(reminderStoreFile).byOrderKey['90002'].wxid, 'wxid_customer_001');
});
