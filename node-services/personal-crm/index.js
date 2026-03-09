require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

const db = new Database('./crm.db');

db.exec(`
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT UNIQUE,
  email TEXT,
  subject TEXT,
  body TEXT,
  score INTEGER DEFAULT 0,
  summary TEXT,
  next_action TEXT,
  stage TEXT DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
`);

function safeAlter(sql) {
  try {
    db.exec(sql);
  } catch (_) {
    // ignore if column already exists
  }
}

safeAlter(`ALTER TABLE leads ADD COLUMN reply_draft TEXT;`);
safeAlter(`ALTER TABLE leads ADD COLUMN replied INTEGER DEFAULT 0;`);
safeAlter(`ALTER TABLE leads ADD COLUMN reply_result TEXT;`);
safeAlter(`ALTER TABLE leads ADD COLUMN category TEXT DEFAULT 'general';`);
safeAlter(`ALTER TABLE leads ADD COLUMN sent_content TEXT;`);
safeAlter(`ALTER TABLE leads ADD COLUMN replied_at TEXT;`);

function normalizeAiResult(result, subject, body) {
  const rawSummary = String(result.summary || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const rawNextAction = String(result.next_action || '人工跟进').trim();
  const rawDraft = String(result.reply_draft || '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const source = `${subject || ''}\n${body || ''}`;
  const looksLikeMeeting = /会议|开会|meeting|腾讯会议|zoom|会议号|密码|线上会议/i.test(source);
  const looksLikeChatty = /需要我帮你|我来帮你|可以帮你|告诉我|设置一个|保存到日历|备忘录/.test(
    `${rawSummary} ${rawDraft}`
  );

  let score = Math.max(0, Math.min(100, Number(result.score || 0)));
  let summary = rawSummary.slice(0, 120) || `邮件主题：${subject || '无主题'}`;
  let nextAction = rawNextAction || '人工跟进';
  let replyDraft = rawDraft.slice(0, 1000);
  let category = String(result.category || 'general').trim().toLowerCase() || 'general';

  if (looksLikeMeeting) {
    score = Math.min(score, 20);
    nextAction = '确认是否需要回复';
    category = 'meeting';
    if (looksLikeChatty || !summary) {
      summary = '会议通知邮件，包含时间和会议信息。';
    }
    if (looksLikeChatty) {
      replyDraft = '';
    }
  }

  if (looksLikeChatty && !looksLikeMeeting) {
    nextAction = '人工确认是否需要回复';
  }

  if (/测试|test|auto_push|crm_test/i.test(source)) {
    category = 'test';
    score = Math.min(score, 10);
    nextAction = '忽略或归档';
  } else if (/验证码|verify|code|security alert|2-step|two-step/i.test(source)) {
    category = 'security';
  } else if (/newsletter|unsubscribe|promotion|促销|营销|发布|introducing/i.test(source)) {
    category = category === 'general' ? 'marketing' : category;
  } else if (/通知|notification|提醒/i.test(source) && category === 'general') {
    category = 'notification';
  }

  return {
    score,
    summary,
    next_action: nextAction,
    reply_draft: replyDraft,
    category
  };
}

async function analyzeWithLLM(subject, body) {
  const prompt =
    [
      '你是企业邮件线索分析器，不是聊天助手。',
      '你的任务是把邮件内容提炼为结构化结果。',
      '禁止输出 Markdown。',
      '禁止输出解释、寒暄、反问、提示项、项目符号、额外文字。',
      '必须只返回一个合法 JSON 对象，字段固定为：',
      '{"score":0-100,"category":"meeting|notification|marketing|security|general|test","summary":"一句话摘要","next_action":"下一步动作建议","reply_draft":"中文回复草稿"}',
      '规则：',
      '1. summary 必须是简洁陈述句，不超过 60 字。',
      '2. next_action 必须是明确动作，不超过 30 字。',
      '3. reply_draft 必须是可直接发给对方的中文邮件回复，不要包含分析说明。',
      '4. 如果邮件只是通知、验证码、系统消息、会议通知、测试邮件，score 应偏低。',
      '5. 如果不适合回复，reply_draft 返回空字符串。',
      '6. category 必须从固定枚举中选择一个。'
    ].join('');

  const resp = await axios.post(
    `${process.env.LLM_BASE_URL}/chat/completions`,
    {
      model: process.env.LLM_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `主题: ${subject}\n正文:\n${(body || '').slice(0, 5000)}` }
      ]
    },
    {
      headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      timeout: 60000
    }
  );

  const raw = String(resp.data.choices[0].message.content || '').trim();

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (_) {
        // Fall through to text fallback.
      }
    }

    if (!parsed) {
      const compact = raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
      parsed = {
        score: 0,
        summary: compact.slice(0, 120) || '模型返回了非结构化文本',
        next_action: '人工跟进',
        reply_draft: ''
      };
    }
  }

  return normalizeAiResult(parsed, subject, body);
}

async function sendMail(to, subject, content) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to,
    subject,
    text: content
  });
}

async function analyzeLeadRow(row) {
  const ai = await analyzeWithLLM(row.subject || '', row.body || '');
  const score = Math.max(0, Math.min(100, Number(ai.score || 0)));
  const summary = String(ai.summary || '');
  const nextAction = String(ai.next_action || '人工跟进');
  const replyDraft = String(ai.reply_draft || '');
  const category = String(ai.category || 'general');

  db.prepare(`
    UPDATE leads
    SET score = ?, summary = ?, next_action = ?, reply_draft = ?, category = ?
    WHERE id = ?
  `).run(score, summary, nextAction, replyDraft, category, row.id);

  return db.prepare('SELECT * FROM leads WHERE id = ?').get(row.id);
}

async function notifyBridge(lead) {
  if (!process.env.BRIDGE_NOTIFY_URL) return;

  try {
    await axios.post(process.env.BRIDGE_NOTIFY_URL, lead, {
      headers: {
        Authorization: `Bearer ${process.env.BRIDGE_NOTIFY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
  } catch (e) {
    console.error('notify bridge fail:', e.response?.data || e.message);
  }
}

async function pollInbox() {
  const client = new ImapFlow({
    logger: false,
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  await client.connect();
  await client.mailboxOpen('INBOX');

  const unseen = await client.search({ seen: false });
  const target = unseen.slice(-3);

  for (const seq of target) {
    const msg = await client.fetchOne(seq, { source: true });
    if (!msg?.source) continue;

    const parsed = await simpleParser(msg.source);
    const messageId = parsed.messageId || `local-${seq}`;
    const exists = db.prepare('SELECT id FROM leads WHERE message_id = ?').get(messageId);
    if (exists) continue;

    const email = parsed.from?.value?.[0]?.address || '';
    const subject = parsed.subject || '';
    const body = parsed.text || '';

    let score = 0;
    let summary = '';
    let nextAction = '人工跟进';
    let replyDraft = '';
    let category = 'general';

    try {
      const ai = await analyzeWithLLM(subject, body);
      score = Math.max(0, Math.min(100, Number(ai.score || 0)));
      summary = String(ai.summary || '');
      nextAction = String(ai.next_action || '人工跟进');
      replyDraft = String(ai.reply_draft || '');
      category = String(ai.category || 'general');
    } catch (e) {
      summary = `LLM分析失败: ${e.response?.status || ''} ${e.message}`;
    }

    const ins = db.prepare(`
      INSERT INTO leads(message_id, email, subject, body, score, summary, next_action, reply_draft, category, replied, reply_result)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')
    `).run(
      messageId,
      email,
      subject,
      body.slice(0, 20000),
      score,
      summary,
      nextAction,
      replyDraft,
      category
    );

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(ins.lastInsertRowid);
    await notifyBridge(lead);
  }

  await client.logout();
}

let isPolling = false;

app.get('/health', (_, res) => res.json({ ok: true, polling: isPolling }));

app.get('/leads', (_, res) => {
  const rows = db.prepare(`
    SELECT id, email, subject, score, category, summary, next_action, reply_draft, replied, reply_result, replied_at, created_at
    FROM leads
    ORDER BY id DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

app.get('/lead/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT id, email, subject, score, category, summary, next_action, reply_draft, replied, reply_result, sent_content, replied_at, created_at
    FROM leads
    WHERE id = ?
  `).get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  res.json({ ok: true, lead: row });
});

app.post('/poll', (_req, res) => {
  if (isPolling) return res.json({ ok: true, queued: false, message: 'poll already running' });

  isPolling = true;
  res.json({ ok: true, queued: true });

  (async () => {
    try {
      await pollInbox();
      console.log('poll done');
    } catch (e) {
      console.error('poll failed:', e.response?.data || e.message);
    } finally {
      isPolling = false;
    }
  })();
});

app.post('/reply/ai/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });

    const draft = row.reply_draft || `您好，关于“${row.subject}”，我们已收到并会尽快处理。`;
    await sendMail(row.email, `Re: ${row.subject}`, draft);
    db.prepare("UPDATE leads SET replied = 1, reply_result = 'ai_sent', sent_content = ?, replied_at = datetime('now','localtime') WHERE id = ?").run(draft, id);
    res.json({ ok: true, id, subject: row.subject, email: row.email, reply_draft: draft, replied_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/lead/:id/reanalyze', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });

    const updated = await analyzeLeadRow(row);
    res.json({
      ok: true,
      lead: {
        id: updated.id,
        email: updated.email,
        subject: updated.subject,
        score: updated.score,
        category: updated.category,
        summary: updated.summary,
        next_action: updated.next_action,
        reply_draft: updated.reply_draft
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/reply/manual/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const content = String(req.body?.content || '').trim();
    if (!content) return res.status(400).json({ ok: false, error: 'content required' });

    const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });

    await sendMail(row.email, `Re: ${row.subject}`, content);
    db.prepare("UPDATE leads SET replied = 1, reply_result = 'manual_sent', sent_content = ?, replied_at = datetime('now','localtime') WHERE id = ?").run(content, id);
    res.json({ ok: true, id, subject: row.subject, email: row.email, sent_content: content, replied_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/lead/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE leads SET reply_result = 'rejected' WHERE id = ?").run(id);
  res.json({ ok: true });
});

const pollSeconds = Number(process.env.POLL_SECONDS || 120);
setInterval(() => {
  if (isPolling) return;
  isPolling = true;

  pollInbox()
    .then(() => console.log('interval poll done'))
    .catch(e => console.error('interval poll failed:', e.response?.data || e.message))
    .finally(() => {
      isPolling = false;
    });
}, pollSeconds * 1000);

const port = Number(process.env.PORT || 9030);
app.listen(port, () => console.log(`personal-crm running on :${port}`));
