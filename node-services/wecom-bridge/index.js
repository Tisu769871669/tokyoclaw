require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());

const TOKEN = process.env.WECOM_TOKEN || '';
const AES_KEY = Buffer.from((process.env.WECOM_ENCODING_AES_KEY || '') + '=', 'base64');
const CORP_ID = process.env.WECOM_CORP_ID || '';
const CRM = process.env.PERSONAL_CRM_BASE_URL || 'http://127.0.0.1:9030';
const OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL || 'http://127.0.0.1:8080/v1';
const OPENCLAW_API_KEY = process.env.OPENCLAW_API_KEY || '';
const OPENCLAW_MODEL = process.env.OPENCLAW_MODEL || 'openclaw';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:9060';

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function sign(ts, nonce, encrypted) {
  return sha1([TOKEN, ts, nonce, encrypted].sort().join(''));
}

function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]><\\/${tag}>`));
  if (m) return m[1];
  const n = xml.match(new RegExp(`<${tag}>(.*?)<\\/${tag}>`));
  return n ? n[1] : '';
}

function pkcs7Decode(buf) {
  const p = buf[buf.length - 1];
  return buf.slice(0, buf.length - p);
}

function pkcs7Encode(buf) {
  let p = 32 - (buf.length % 32);
  if (!p) p = 32;
  return Buffer.concat([buf, Buffer.alloc(p, p)]);
}

function decrypt(encryptedBase64) {
  const iv = AES_KEY.subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, iv);
  decipher.setAutoPadding(false);

  let plain = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final()
  ]);
  plain = pkcs7Decode(plain);

  const len = plain.readUInt32BE(16);
  const msg = plain.subarray(20, 20 + len).toString('utf8');
  const recv = plain.subarray(20 + len).toString('utf8');

  if (CORP_ID && recv !== CORP_ID) {
    throw new Error(`receiveId mismatch: got=${recv}, expect=${CORP_ID}`);
  }

  return msg;
}

function encrypt(plain) {
  const iv = AES_KEY.subarray(0, 16);
  const rand16 = crypto.randomBytes(16);
  const msgBuf = Buffer.from(plain, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);

  const raw = Buffer.concat([rand16, lenBuf, msgBuf, Buffer.from(CORP_ID, 'utf8')]);
  const padded = pkcs7Encode(raw);

  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

function plainReply(to, from, content) {
  return `<xml><ToUserName><![CDATA[${to}]]></ToUserName><FromUserName><![CDATA[${from}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${content.slice(0, 1800)}]]></Content></xml>`;
}

function encryptedReply(plainXml) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(8).toString('hex');
  const enc = encrypt(plainXml);
  const sig = sign(ts, nonce, enc);
  return `<xml><Encrypt><![CDATA[${enc}]]></Encrypt><MsgSignature><![CDATA[${sig}]]></MsgSignature><TimeStamp>${ts}</TimeStamp><Nonce><![CDATA[${nonce}]]></Nonce></xml>`;
}

let cachedToken = { val: '', exp: 0 };

async function getWecomToken() {
  const now = Date.now();
  if (cachedToken.val && now < cachedToken.exp) return cachedToken.val;

  const r = await axios.get('https://qyapi.weixin.qq.com/cgi-bin/gettoken', {
    params: {
      corpid: process.env.WECOM_CORP_ID,
      corpsecret: process.env.WECOM_SECRET
    },
    timeout: 10000
  });

  if (r.data.errcode !== 0) {
    throw new Error(JSON.stringify(r.data));
  }

  cachedToken = {
    val: r.data.access_token,
    exp: now + (r.data.expires_in - 60) * 1000
  };

  return cachedToken.val;
}

async function pushText(content, toUser) {
  const token = await getWecomToken();
  const touser = toUser || process.env.WECOM_TOUSER;
  const chunks = splitByBytes(content, 1800);

  for (const chunk of chunks) {
    const r = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        touser,
        msgtype: 'text',
        agentid: Number(process.env.WECOM_AGENT_ID),
        text: { content: chunk }
      },
      { timeout: 10000 }
    );

    if (r.data.errcode !== 0) {
      throw new Error(JSON.stringify(r.data));
    }
  }
}

function splitByBytes(text, maxBytes = 1800) {
  const out = [];
  let cur = '';
  for (const ch of String(text || '')) {
    if (Buffer.byteLength(cur + ch, 'utf8') > maxBytes) {
      if (cur) out.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function compactText(text, limit = 220) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit) || '无';
}

function sanitizeChatReply(text) {
  const cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '- ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const parts = cleaned
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 8);

  return parts.join('\n').slice(0, 1500) || '收到你的消息了，但没有得到可读回复。';
}

function categoryLabel(category) {
  const key = String(category || 'general').toLowerCase();
  const labels = {
    meeting: '会议',
    notification: '通知',
    marketing: '营销',
    security: '安全',
    test: '测试',
    general: '普通'
  };
  return labels[key] || key;
}

async function handleCmd(content) {
  const t = (content || '').trim();
  const low = t.toLowerCase();

  if (low === 'help' || low === 'crm help') {
    return [
      'personal-crm 指令帮助',
      '',
      '基础命令:',
      'status  查看 personal-crm 服务状态',
      'poll  立即触发一次收件轮询',
      'dashboard  查看管理看板地址',
      'leads  查看最近 3 条线索及分析',
      '',
      '线索操作:',
      'draft <id>  查看该线索的 AI 分析和回复草稿',
      'reanalyze <id>  重新调用 AI 分析该线索',
      'approve <id>  先预览 AI 草稿并进入确认步骤',
      'confirm approve <id>  确认发送 AI 草稿',
      'reply <id> <内容>  用你提供的内容手动回复',
      'reject <id>  标记该线索暂不回复'
    ].join('\n');
  }

  if (low === 'status') {
    const r = await axios.get(`${CRM}/health`, { timeout: 8000 });
    return `personal-crm: ${JSON.stringify(r.data)}`;
  }

  if (low === 'poll') {
    axios.post(`${CRM}/poll`, {}, { timeout: 120000 }).catch(() => {});
    return '已触发 poll，稍后发 leads 查看';
  }

  if (low === 'dashboard') {
    return `管理看板地址:\n${DASHBOARD_URL}`;
  }

  if (low === 'leads') {
    const r = await axios.get(`${CRM}/leads`, { timeout: 8000 });
    const top = (Array.isArray(r.data) ? r.data : []).slice(0, 3);
    if (!top.length) return '最新线索: 无';
    return '最新线索:\n' + top.map(x =>
      [
        `#${x.id} ${x.subject} (${x.email})`,
        `评分: ${x.score ?? 0}`,
        `分类: ${categoryLabel(x.category)}`,
        `摘要: ${compactText(x.summary, 120)}`,
        `建议: ${compactText(x.next_action, 80)}`,
        `草稿: ${compactText(x.reply_draft, 140)}`
      ].join('\n')
    ).join('\n\n');
  }

  if (/^approve\s+\d+$/i.test(t)) {
    const id = t.split(/\s+/)[1];
    const r = await axios.get(`${CRM}/lead/${id}`, { timeout: 8000 });
    const lead = r.data?.lead;
    if (!lead) return `未找到线索 #${id}`;
    return [
      `准备发送 AI 草稿，线索 #${id}`,
      `主题: ${lead.subject || '无'}`,
      `发件人: ${lead.email || '无'}`,
      `分类: ${categoryLabel(lead.category)}`,
      `当前草稿:`,
      compactText(lead.reply_draft, 1200),
      '',
      `请确认发送: confirm approve ${id}`
    ].join('\n');
  }

  if (/^confirm\s+approve\s+\d+$/i.test(t)) {
    const id = t.trim().split(/\s+/)[2];
    const r = await axios.post(`${CRM}/reply/ai/${id}`, {}, { timeout: 15000 });
    const sentDraft = r.data?.reply_draft || '';
    return [
      `已发送 AI 草稿回复，线索 #${id}`,
      `主题: ${r.data?.subject || '无'}`,
      `发件人: ${r.data?.email || '无'}`,
      `发送时间: ${r.data?.replied_at || '已发送'}`,
      `已发送内容:`,
      compactText(sentDraft, 1200)
    ].join('\n');
  }

  if (/^reanalyze\s+\d+$/i.test(t)) {
    const id = t.split(/\s+/)[1];
    const r = await axios.post(`${CRM}/lead/${id}/reanalyze`, {}, { timeout: 70000 });
    const lead = r.data?.lead;
    if (!lead) return `重分析失败，线索 #${id}`;
    return [
      `已重分析线索 #${id}`,
      `主题: ${lead.subject || '无'}`,
      `发件人: ${lead.email || '无'}`,
      `评分: ${lead.score ?? 0}`,
      `分类: ${categoryLabel(lead.category)}`,
      `摘要: ${compactText(lead.summary, 300)}`,
      `建议: ${compactText(lead.next_action, 200)}`,
      `AI草稿:`,
      compactText(lead.reply_draft, 1200)
    ].join('\n');
  }

  if (/^reject\s+\d+$/i.test(t)) {
    const id = t.split(/\s+/)[1];
    await axios.post(`${CRM}/lead/${id}/reject`, {}, { timeout: 15000 });
    return `已拒绝回复，线索 #${id}`;
  }

  if (/^reply\s+\d+\s+/i.test(t)) {
    const m = t.match(/^reply\s+(\d+)\s+([\s\S]+)$/i);
    const id = m[1];
    const txt = m[2];
    const r = await axios.post(`${CRM}/reply/manual/${id}`, { content: txt }, { timeout: 15000 });
    return [
      `已按你内容发送，线索 #${id}`,
      `主题: ${r.data?.subject || '无'}`,
      `发件人: ${r.data?.email || '无'}`,
      `发送时间: ${r.data?.replied_at || '已发送'}`,
      `已发送内容:`,
      compactText(r.data?.sent_content || txt, 1200)
    ].join('\n');
  }

  if (/^draft\s+\d+$/i.test(t)) {
    const id = t.split(/\s+/)[1];
    const r = await axios.get(`${CRM}/lead/${id}`, { timeout: 8000 });
    const lead = r.data?.lead;
    if (!lead) return `未找到线索 #${id}`;
    return [
      `线索 #${id}`,
      `主题: ${lead.subject || '无'}`,
      `发件人: ${lead.email || '无'}`,
      `评分: ${lead.score ?? 0}`,
      `分类: ${categoryLabel(lead.category)}`,
      `摘要: ${compactText(lead.summary, 300)}`,
      `建议: ${compactText(lead.next_action, 200)}`,
      `AI草稿:`,
      compactText(lead.reply_draft, 1200),
      `已回复: ${lead.replied ? '是' : '否'}`,
      `发送记录: ${compactText(lead.sent_content, 600)}`,
      `发送时间: ${lead.replied_at || '无'}`
    ].join('\n');
  }

  return [
    '命令说明:',
    'help  查看 personal-crm 指令帮助',
    'status  查看 personal-crm 服务状态',
    'poll  立即触发一次收件轮询',
    'dashboard  查看管理看板地址',
    'leads  查看最近 3 条线索及分析',
    'draft <id>  查看该线索的 AI 分析和回复草稿',
    'reanalyze <id>  重新调用 AI 分析该线索',
    'approve <id>  先预览 AI 草稿并进入确认步骤',
    'confirm approve <id>  确认发送 AI 草稿',
    'reply <id> <内容>  用你提供的内容手动回复',
    'reject <id>  标记该线索不回复'
  ].join('\n');
}

function isCommand(content) {
  const t = (content || '').trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (low === 'help' || low === 'crm help') return true;
  if (low === 'status' || low === 'poll' || low === 'leads' || low === 'dashboard') return true;
  if (/^draft\s+\d+$/i.test(t)) return true;
  if (/^reanalyze\s+\d+$/i.test(t)) return true;
  if (/^approve\s+\d+$/i.test(t)) return true;
  if (/^confirm\s+approve\s+\d+$/i.test(t)) return true;
  if (/^reject\s+\d+$/i.test(t)) return true;
  if (/^reply\s+\d+\s+/i.test(t)) return true;
  return false;
}

function normalizeCommand(content) {
  const t = (content || '').trim();
  if (!t) return t;

  if (/最近.*(3|三).*封.*邮件/.test(t)) return 'leads';
  if (/查看.*最近.*邮件/.test(t)) return 'leads';
  if (/最新.*邮件/.test(t)) return 'leads';
  if (/查看.*邮件/.test(t)) return 'leads';
  if (/看板|dashboard|仪表盘/.test(t)) return 'dashboard';
  if (/^help$/i.test(t) || /^crm help$/i.test(t) || /帮助|命令/.test(t)) return 'help';

  return t;
}

async function chatWithOpenClaw(userText) {
  const url = `${OPENCLAW_BASE_URL.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (OPENCLAW_API_KEY) {
    headers.Authorization = `Bearer ${OPENCLAW_API_KEY}`;
  }

  const r = await axios.post(
    url,
    {
      model: OPENCLAW_MODEL,
      messages: [{ role: 'user', content: userText }]
    },
    { headers, timeout: 60000 }
  );

  const text = r?.data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    return '收到你的消息了，但模型没有返回可读文本。';
  }

  return sanitizeChatReply(text);
}

app.get('/health', (_, res) => res.json({ ok: true }));

app.get('/wecom/callback', (req, res) => {
  try {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    if (sign(String(timestamp || ''), String(nonce || ''), String(echostr || '')) !== msg_signature) {
      return res.status(403).send('forbidden');
    }

    return res.status(200).send(decrypt(String(echostr || '')));
  } catch (e) {
    console.error('verify error:', e.message);
    return res.status(500).send('error');
  }
});

app.post('/wecom/callback', express.text({ type: ['application/xml', 'text/xml'] }), async (req, res) => {
  try {
    const { msg_signature, timestamp, nonce } = req.query;
    const encrypted = getTag(req.body || '', 'Encrypt');
    if (sign(String(timestamp || ''), String(nonce || ''), String(encrypted || '')) !== msg_signature) {
      return res.status(403).send('forbidden');
    }

    const plain = decrypt(encrypted);
    const msgType = getTag(plain, 'MsgType');
    const fromUser = getTag(plain, 'FromUserName');
    const content = getTag(plain, 'Content') || '';
    const normalizedContent = normalizeCommand(content);

    // Must return fast for WeCom callback. Do async processing below.
    res.status(200).send('success');

    if (msgType !== 'text') return;

    (async () => {
      try {
        if (isCommand(normalizedContent)) {
          const reply = await handleCmd(normalizedContent);
          await pushText(reply, fromUser);
        } else {
          await pushText('收到，正在处理，请稍候。', fromUser);
          const reply = await chatWithOpenClaw(content);
          await pushText(reply, fromUser);
        }
      } catch (e) {
        await pushText(`执行失败: ${e.message}`, fromUser);
      }
    })();

    return;
  } catch (e) {
    console.error('post error:', e.message);
    return res.status(200).send('success');
  }
});

app.post('/notify/new-lead', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.BRIDGE_NOTIFY_TOKEN}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const x = req.body || {};

    await pushText(
      [
        `新邮件线索 #${x.id}`,
        `主题: ${x.subject || '无'}`,
        `发件人: ${x.email || '无'}`,
        `评分: ${x.score ?? 0}`,
        `分类: ${categoryLabel(x.category)}`,
        `摘要: ${compactText(x.summary, 300)}`,
        `建议: ${compactText(x.next_action, 160)}`,
        `AI草稿: ${compactText(x.reply_draft, 500)}`,
        '',
        '回复命令:',
        `draft ${x.id}  查看这条线索的完整 AI 分析和草稿`,
        `reanalyze ${x.id}  重新调用 AI 分析这条线索`,
        `approve ${x.id}  先预览 AI 草稿，确认后再发送`,
        `confirm approve ${x.id}  确认发送 AI 草稿`,
        `reply ${x.id} 你的回复内容  用你的文字手动回复`,
        `reject ${x.id}  标记这条线索暂不回复`
      ].join('\n')
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/notify/text', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${process.env.BRIDGE_NOTIFY_TOKEN}`) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const content = String(req.body?.content || '').trim();
    const toUser = String(req.body?.to_user || '').trim() || undefined;
    if (!content) {
      return res.status(400).json({ ok: false, error: 'content required' });
    }

    await pushText(content, toUser);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(process.env.PORT || 9050, () => console.log('wecom-bridge on :9050'));
