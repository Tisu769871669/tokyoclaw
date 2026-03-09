require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const dbPath = process.env.CRM_DB_PATH || '/opt/personal-crm/crm.db';
const db = new Database(dbPath, { readonly: true });

let lastRunAt = null;
let lastStatus = 'idle';
let isRunning = false;

function compact(text, limit = 140) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit) || '无';
}

function queryOne(sql, params = []) {
  return db.prepare(sql).get(params);
}

function queryAll(sql, params = []) {
  return db.prepare(sql).all(params);
}

function collectBriefData() {
  const totals = queryOne(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN replied = 0 THEN 1 ELSE 0 END) AS unreplied,
      SUM(CASE WHEN score >= 70 THEN 1 ELSE 0 END) AS hot
    FROM leads`
  );

  const last24h = queryOne(
    `SELECT COUNT(*) AS count
     FROM leads
     WHERE datetime(created_at) >= datetime('now', '-1 day', 'localtime')`
  );

  const categories = queryAll(
    `SELECT COALESCE(category, 'general') AS category, COUNT(*) AS count
     FROM leads
     WHERE datetime(created_at) >= datetime('now', '-1 day', 'localtime')
     GROUP BY COALESCE(category, 'general')
     ORDER BY count DESC`
  );

  const topPending = queryAll(
    `SELECT id, email, subject, score, category, summary, next_action, reply_draft, created_at
     FROM leads
     WHERE replied = 0
     ORDER BY score DESC, id DESC
     LIMIT 5`
  );

  const latest = queryAll(
    `SELECT id, email, subject, score, category, summary, next_action, created_at
     FROM leads
     ORDER BY id DESC
     LIMIT 5`
  );

  return {
    totals,
    last24h,
    categories,
    topPending,
    latest
  };
}

async function generateBriefWithLLM(data) {
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !process.env.LLM_MODEL) {
    return null;
  }

  const prompt = [
    '你是销售团队晨报助手。',
    '请根据输入数据输出简洁中文晨报。',
    '不要使用 Markdown。',
    '控制在 800 字以内。',
    '结构固定为：',
    '1. 今日概况',
    '2. 重点跟进',
    '3. 风险提醒',
    '4. 建议动作',
    '内容要具体，引用线索ID。'
  ].join('');

  const payload = {
    model: process.env.LLM_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: JSON.stringify(data) }
    ]
  };

  const resp = await axios.post(
    `${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    payload,
    {
      headers: { Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      timeout: 60000
    }
  );

  return String(resp.data?.choices?.[0]?.message?.content || '').trim();
}

function generateFallbackBrief(data) {
  const categoryText = data.categories.length
    ? data.categories.map(x => `${x.category}:${x.count}`).join('，')
    : '无新增';
  const hot = data.topPending.filter(x => Number(x.score || 0) >= 70);

  const lines = [
    '销售晨报',
    `今日概况：总线索 ${data.totals?.total || 0}，24小时新增 ${data.last24h?.count || 0}，未回复 ${data.totals?.unreplied || 0}，高分线索 ${data.totals?.hot || 0}。`,
    `分类分布：${categoryText}。`
  ];

  if (data.topPending.length) {
    lines.push('重点跟进：');
    for (const lead of data.topPending.slice(0, 3)) {
      lines.push(
        `#${lead.id} ${compact(lead.subject, 40)}，评分 ${lead.score || 0}，分类 ${lead.category || 'general'}，建议 ${compact(lead.next_action, 40)}。`
      );
    }
  } else {
    lines.push('重点跟进：当前没有待回复线索。');
  }

  if (hot.length) {
    lines.push(`风险提醒：高分未回复线索 ${hot.map(x => `#${x.id}`).join('、')} 需要优先处理。`);
  } else {
    lines.push('风险提醒：当前没有明显高风险积压。');
  }

  lines.push('建议动作：先处理高分未回复线索，再清理会议/测试/通知类低优先级邮件。');
  return lines.join('\n');
}

async function buildBrief() {
  const data = collectBriefData();
  try {
    const llmText = await generateBriefWithLLM(data);
    if (llmText) return llmText;
  } catch (e) {
    console.error('brief llm fail:', e.response?.data || e.message);
  }
  return generateFallbackBrief(data);
}

async function sendBrief(content) {
  await axios.post(
    process.env.BRIDGE_TEXT_URL,
    { content, to_user: process.env.BRIDGE_TOUSER || undefined },
    {
      headers: {
        Authorization: `Bearer ${process.env.BRIDGE_NOTIFY_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000
    }
  );
}

async function runBrief(trigger) {
  if (isRunning) {
    return { ok: true, queued: false, message: 'brief already running' };
  }

  isRunning = true;
  lastStatus = 'running';

  try {
    const brief = await buildBrief();
    await sendBrief(brief);
    lastRunAt = new Date().toISOString();
    lastStatus = `ok:${trigger}`;
    return { ok: true, queued: true, brief };
  } catch (e) {
    lastStatus = `error:${e.message}`;
    throw e;
  } finally {
    isRunning = false;
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, running: isRunning, lastRunAt, lastStatus, dbPath });
});

app.post('/run', async (_req, res) => {
  try {
    const result = await runBrief('manual');
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

const cronExpr = process.env.BRIEF_CRON || '0 9 * * 1-5';
cron.schedule(
  cronExpr,
  () => {
    runBrief('cron').catch(e => console.error('brief run fail:', e.response?.data || e.message));
  },
  { timezone: process.env.TZ || 'Asia/Shanghai' }
);

const port = Number(process.env.PORT || 9040);
app.listen(port, () => console.log(`custom-morning-brief running on :${port}`));
