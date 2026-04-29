const fs = require('fs');
const path = require('path');

const DEFAULT_STORE_FILE = path.join(__dirname, '.sessions', 'wxid-bindings.json');
const PHONE_FIELDS = [
  'mobile',
  'phone',
  'userMobile',
  'loginMobile',
  'tel',
  'telephone',
  'receiverMobile',
  'logisticsPhone'
];

function cleanText(value) {
  return String(value || '').trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return '';
}

function numericId(value) {
  const text = cleanText(value);
  return /^\d+$/.test(text) ? text : '';
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

function defaultBindingStore() {
  return {
    version: 1,
    updatedAt: '',
    byWxid: {},
    byOrderUserId: {}
  };
}

function loadBindingStore(storeFile = DEFAULT_STORE_FILE) {
  const store = safeJsonRead(storeFile, defaultBindingStore());
  return {
    version: 1,
    updatedAt: cleanText(store.updatedAt),
    byWxid: store.byWxid && typeof store.byWxid === 'object' ? store.byWxid : {},
    byOrderUserId: store.byOrderUserId && typeof store.byOrderUserId === 'object' ? store.byOrderUserId : {}
  };
}

function saveBindingStore(storeFile, store) {
  safeJsonWrite(storeFile, store);
}

function extractOrderUserId(body) {
  const direct = numericId(
    body?.orderUserId ||
    body?.order_user_id ||
    body?.memberUserId ||
    body?.member_user_id ||
    body?.xcdhtUserId ||
    body?.xcdht_user_id
  );
  if (direct) return direct;

  const order = body?.order || body?.orderInfo || body?.order_info;
  const nested = numericId(order?.userId || order?.user_id || order?.memberUserId || order?.member_user_id);
  if (nested) return nested;

  if (Array.isArray(body?.orders)) {
    for (const item of body.orders) {
      const itemUserId = numericId(item?.userId || item?.user_id || item?.memberUserId || item?.member_user_id);
      if (itemUserId) return itemUserId;
    }
  }

  return numericId(body?.userId || body?.user_id);
}

function extractBindingCandidate(body) {
  if (!body || typeof body !== 'object') return null;

  const wxid = firstText(
    body.wxid,
    body.wechatId,
    body.wechat_id,
    body.sendId,
    body.senderWxid,
    body.sender_wxid,
    body.conversationId,
    body.conversation_id
  );
  const orderUserId = extractOrderUserId(body);
  if (!wxid || !orderUserId) return null;

  const conversationId = firstText(body.conversationId, body.conversation_id, wxid);
  return {
    wxid,
    orderUserId,
    tenantId: firstText(body.tenantId, body.tenantid, body.tenant_id),
    conversationId
  };
}

function extractPhoneFromMemberProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;

  for (const field of PHONE_FIELDS) {
    const phone = cleanText(profile[field]);
    if (phone) {
      return {
        phone,
        field
      };
    }
  }
  return null;
}

function buildBinding(candidate, memberProfile, phoneResult, now) {
  const updatedAt = now().toISOString();
  return {
    wxid: candidate.wxid,
    orderUserId: candidate.orderUserId,
    phone: phoneResult.phone,
    phoneField: phoneResult.field,
    tenantId: candidate.tenantId,
    conversationId: candidate.conversationId,
    memberProfileId: cleanText(memberProfile?.id),
    source: 'order_user_lookup',
    updatedAt
  };
}

async function bindWxidFromOrderUser(body, options = {}) {
  const candidate = extractBindingCandidate(body);
  if (!candidate) {
    return {
      bound: false,
      reason: 'binding_candidate_not_found'
    };
  }

  const lookupUserById = options.lookupUserById;
  if (typeof lookupUserById !== 'function') {
    return {
      bound: false,
      reason: 'lookup_not_configured',
      orderUserId: candidate.orderUserId,
      wxid: candidate.wxid
    };
  }

  const memberProfile = await lookupUserById(candidate.orderUserId, candidate);
  const phoneResult = extractPhoneFromMemberProfile(memberProfile);
  if (!phoneResult) {
    return {
      bound: false,
      reason: 'phone_not_found',
      orderUserId: candidate.orderUserId,
      wxid: candidate.wxid
    };
  }

  const storeFile = options.storeFile || DEFAULT_STORE_FILE;
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const binding = buildBinding(candidate, memberProfile, phoneResult, now);
  const store = loadBindingStore(storeFile);
  store.updatedAt = binding.updatedAt;
  store.byWxid[binding.wxid] = binding;
  store.byOrderUserId[binding.orderUserId] = binding;
  saveBindingStore(storeFile, store);

  return {
    bound: true,
    binding
  };
}

async function runWxidBindingFromPayload(body, options = {}) {
  try {
    return await bindWxidFromOrderUser(body, options);
  } catch (err) {
    const candidate = extractBindingCandidate(body);
    const message = cleanText(err?.message) || 'wxid binding lookup failed';
    const logger = options.logger || console;
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`wxid binding skipped: ${message}`);
    }
    return {
      bound: false,
      reason: 'lookup_failed',
      orderUserId: candidate?.orderUserId || '',
      wxid: candidate?.wxid || ''
    };
  }
}

module.exports = {
  bindWxidFromOrderUser,
  extractBindingCandidate,
  extractOrderUserId,
  extractPhoneFromMemberProfile,
  loadBindingStore,
  runWxidBindingFromPayload,
  saveBindingStore
};
