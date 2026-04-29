const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { bindWxidFromOrderUser, loadBindingStore } = require('./wxid-binding');
const { resolveFriendWelcomeCredentials } = require('./friend-welcome');

const DEFAULT_SEND_URL = 'https://lx.metast.cn/prod-api/system/api/im/sendWxIdMesage';
const DEFAULT_STORE_FILE = path.join(__dirname, '.sessions', 'payment-reminders.json');
const DEFAULT_COOLDOWN_HOURS = 24;
const DEFAULT_TIMEOUT_MS = 10000;

function cleanText(value) {
  return String(value || '').trim();
}

function numericId(value) {
  const text = cleanText(value);
  return /^\d+$/.test(text) ? text : '';
}

function isTruthyFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(cleanText(value).toLowerCase());
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function safeJsonWrite(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function defaultReminderStore() {
  return {
    version: 1,
    updatedAt: '',
    byOrderKey: {}
  };
}

function loadReminderStore(storeFile = DEFAULT_STORE_FILE) {
  const store = safeJsonRead(storeFile, defaultReminderStore());
  return {
    version: 1,
    updatedAt: cleanText(store.updatedAt),
    byOrderKey: store.byOrderKey && typeof store.byOrderKey === 'object' ? store.byOrderKey : {}
  };
}

function saveReminderStore(storeFile, store) {
  safeJsonWrite(storeFile, store);
}

function isPaidStatus(value) {
  const text = cleanText(value).toLowerCase();
  return ['1', 'true', 'paid', 'yes', '已付款', '已支付'].includes(text);
}

function isPendingPaymentOrder(order) {
  if (!order || typeof order !== 'object') return false;
  if (isPaidStatus(order.payStatus ?? order.pay_status ?? order.paid)) return false;

  const status = cleanText(order.status ?? order.orderStatus ?? order.order_status);
  const statusText = cleanText(order.statusText ?? order.statusName ?? order.status_name);
  return status === '5' || /待付款/.test(statusText);
}

function orderUserId(order) {
  return numericId(order?.userId || order?.user_id || order?.memberUserId || order?.member_user_id);
}

function collectOrders(body) {
  const orders = [];
  if (Array.isArray(body?.orders)) orders.push(...body.orders);
  if (body?.order && typeof body.order === 'object') orders.push(body.order);
  if (body?.orderInfo && typeof body.orderInfo === 'object') orders.push(body.orderInfo);
  if (body?.order_info && typeof body.order_info === 'object') orders.push(body.order_info);
  if (body && typeof body === 'object' && orderUserId(body)) orders.push(body);
  return orders.filter(item => item && typeof item === 'object');
}

function extractPendingPaymentOrder(body) {
  return collectOrders(body).find(isPendingPaymentOrder) || null;
}

function orderKey(order) {
  return firstText(order?.id, order?.orderId, order?.order_id, order?.no, order?.orderNo, order?.order_no);
}

function buildPaymentReminderContent(order, env = process.env) {
  const explicit = cleanText(env.PAYMENT_REMINDER_CONTENT);
  if (explicit) return explicit;

  const no = firstText(order?.no, order?.orderNo, order?.order_no, order?.id, order?.orderId, order?.order_id);
  const amount = firstText(order?.payPrice, order?.payPriceH, order?.totalPrice, order?.totalPriceH);
  const parts = ['亲亲，您有一笔订单还在待付款状态'];
  if (no) parts.push(`订单号：${no}`);
  if (amount) parts.push(`应付金额：${amount}`);
  parts.push('需要的话可以直接在小程序里完成付款，我们这边会尽快帮您继续处理。');
  return parts.join('\n');
}

function buildPaymentReminderSendRequest(binding, order, body = {}, env = process.env) {
  const tenantId = firstText(body.tenantId, body.tenantid, body.tenant_id, binding?.tenantId, env.PAYMENT_REMINDER_TENANT_ID, '125');
  const { mcpKey, mcpSecret } = resolveFriendWelcomeCredentials(tenantId, env);
  const sendUrl = cleanText(env.PAYMENT_REMINDER_SEND_URL || env.FRIEND_WELCOME_SEND_URL) || DEFAULT_SEND_URL;
  const recvId = firstText(body.recvId, body.serviceWxid, body.service_wxid, env.PAYMENT_REMINDER_RECV_ID, env.PAYMENT_REMINDER_SERVICE_WXID);
  const sendId = cleanText(binding?.wxid);
  const content = buildPaymentReminderContent(order, env);

  const missing = [];
  if (!sendId) missing.push('bound wxid');
  if (!recvId) missing.push('recvId or PAYMENT_REMINDER_RECV_ID');
  if (!tenantId) missing.push('tenantId');
  if (!mcpKey) missing.push(`mcpKey for tenant ${tenantId || 'unknown'}`);
  if (!mcpSecret) missing.push(`mcpSecret for tenant ${tenantId || 'unknown'}`);
  if (!content) missing.push('payment reminder content');
  if (missing.length) {
    throw new Error(`payment reminder config missing: ${missing.join(', ')}`);
  }

  const url = new URL(sendUrl);
  url.searchParams.set('sendId', sendId);
  url.searchParams.set('recvId', recvId);
  url.searchParams.set('tenantId', tenantId);
  url.searchParams.set('content', content);

  return {
    url,
    headers: {
      mcpKey,
      mcpSecret
    },
    timeoutMs: Number(env.PAYMENT_REMINDER_SEND_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
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
        const error = new Error(`payment reminder send failed with HTTP ${response.statusCode}`);
        error.statusCode = response.statusCode;
        error.body = body;
        reject(error);
      });
    });

    request.setTimeout(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1), () => {
      request.destroy(new Error('payment reminder send timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function resolveBindingForOrder(body, order, options) {
  const bindingStoreFile = options.bindingStoreFile;
  const userId = orderUserId(order);
  if (!userId) return null;

  const store = loadBindingStore(bindingStoreFile);
  const existing = store.byOrderUserId?.[userId];
  if (existing?.wxid) return existing;

  const lookupUserById = options.lookupUserById;
  if (typeof lookupUserById !== 'function') return null;
  const bindResult = await bindWxidFromOrderUser(
    {
      ...body,
      order
    },
    {
      storeFile: bindingStoreFile,
      lookupUserById,
      now: options.now
    }
  );
  return bindResult.bound ? bindResult.binding : null;
}

function cooldownMs(env = process.env) {
  const hours = Number(env.PAYMENT_REMINDER_COOLDOWN_HOURS || DEFAULT_COOLDOWN_HOURS);
  return Math.max(hours, 0) * 60 * 60 * 1000;
}

async function runPaymentReminderFromPayload(body, options = {}) {
  try {
    const order = extractPendingPaymentOrder(body);
    if (!order) {
      return {
        reminded: false,
        reason: 'pending_order_not_found'
      };
    }

    const binding = await resolveBindingForOrder(body, order, options);
    if (!binding) {
      return {
        reminded: false,
        reason: 'binding_not_found',
        orderUserId: orderUserId(order)
      };
    }

    const env = options.env || process.env;
    const sendEnabled = typeof options.sendEnabled === 'boolean'
      ? options.sendEnabled
      : isTruthyFlag(env.PAYMENT_REMINDER_SEND_ENABLED);
    const key = orderKey(order);
    const now = typeof options.now === 'function' ? options.now() : new Date();

    if (!sendEnabled) {
      return {
        reminded: false,
        reason: 'dry_run',
        wouldSend: true,
        orderKey: key,
        wxid: binding.wxid
      };
    }

    if (!key) {
      return {
        reminded: false,
        reason: 'order_key_not_found',
        wxid: binding.wxid
      };
    }

    const reminderStoreFile = options.reminderStoreFile || DEFAULT_STORE_FILE;
    const store = loadReminderStore(reminderStoreFile);
    const previous = store.byOrderKey[key];
    if (previous?.sentAt && now.getTime() - new Date(previous.sentAt).getTime() < cooldownMs(env)) {
      return {
        reminded: false,
        reason: 'cooldown_active',
        orderKey: key,
        wxid: binding.wxid
      };
    }

    const request = buildPaymentReminderSendRequest(binding, order, body, env);
    const sender = typeof options.sendMessage === 'function' ? options.sendMessage : sendGetRequest;
    const sendResult = await sender(request);
    const sentAt = now.toISOString();
    store.updatedAt = sentAt;
    store.byOrderKey[key] = {
      orderKey: key,
      orderUserId: orderUserId(order),
      wxid: binding.wxid,
      phone: binding.phone,
      sentAt,
      statusCode: sendResult?.statusCode || 0
    };
    saveReminderStore(reminderStoreFile, store);

    return {
      reminded: true,
      orderKey: key,
      wxid: binding.wxid,
      statusCode: sendResult?.statusCode || 0
    };
  } catch (err) {
    const logger = options.logger || console;
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`payment reminder skipped: ${cleanText(err?.message) || 'unknown error'}`);
    }
    return {
      reminded: false,
      reason: 'reminder_failed'
    };
  }
}

module.exports = {
  buildPaymentReminderContent,
  buildPaymentReminderSendRequest,
  extractPendingPaymentOrder,
  isPendingPaymentOrder,
  loadReminderStore,
  runPaymentReminderFromPayload,
  sendGetRequest
};
