require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');

const app = express();
const port = Number(process.env.PORT || 9060);
const title = process.env.DASHBOARD_TITLE || 'TokyoClaw Sales Dashboard';
const dbPath = process.env.CRM_DB_PATH || '/opt/claw/node-services/personal-crm/crm.db';
const db = new Database(dbPath, { readonly: true });

function one(sql, params = []) {
  return db.prepare(sql).get(params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(params);
}

function compact(text, limit = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit) || '无';
}

function buildDashboardData() {
  const overview = one(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN replied = 0 THEN 1 ELSE 0 END) AS open_count,
      SUM(CASE WHEN replied = 1 THEN 1 ELSE 0 END) AS replied_count,
      SUM(CASE WHEN score >= 70 THEN 1 ELSE 0 END) AS hot_count,
      ROUND(AVG(COALESCE(score, 0)), 1) AS avg_score
    FROM leads
  `);

  const newToday = one(`
    SELECT COUNT(*) AS count
    FROM leads
    WHERE date(created_at) = date('now','localtime')
  `);

  const new7d = one(`
    SELECT COUNT(*) AS count
    FROM leads
    WHERE datetime(created_at) >= datetime('now','-7 day','localtime')
  `);

  const categoryBreakdown = all(`
    SELECT COALESCE(category, 'general') AS category, COUNT(*) AS count
    FROM leads
    GROUP BY COALESCE(category, 'general')
    ORDER BY count DESC, category ASC
  `);

  const replyBreakdown = all(`
    SELECT
      CASE
        WHEN replied = 1 THEN COALESCE(reply_result, 'sent')
        ELSE 'pending'
      END AS bucket,
      COUNT(*) AS count
    FROM leads
    GROUP BY bucket
    ORDER BY count DESC, bucket ASC
  `);

  const pendingQueue = all(`
    SELECT id, email, subject, score, category, summary, next_action, created_at
    FROM leads
    WHERE replied = 0
    ORDER BY score DESC, id DESC
    LIMIT 8
  `);

  const recentActivity = all(`
    SELECT id, email, subject, score, category, summary, replied, reply_result, replied_at, created_at
    FROM leads
    ORDER BY id DESC
    LIMIT 12
  `);

  const trend = all(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM leads
    WHERE datetime(created_at) >= datetime('now','-6 day','localtime')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `);

  return {
    title,
    dbPath,
    generatedAt: new Date().toISOString(),
    overview: {
      total: Number(overview?.total || 0),
      openCount: Number(overview?.open_count || 0),
      repliedCount: Number(overview?.replied_count || 0),
      hotCount: Number(overview?.hot_count || 0),
      avgScore: Number(overview?.avg_score || 0),
      newToday: Number(newToday?.count || 0),
      new7d: Number(new7d?.count || 0)
    },
    categoryBreakdown,
    replyBreakdown,
    pendingQueue,
    recentActivity,
    trend
  };
}

function renderPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      --bg: #f2efe8;
      --ink: #18222d;
      --muted: #5c6975;
      --panel: rgba(255,255,255,.74);
      --line: rgba(24,34,45,.12);
      --accent: #d95d39;
      --accent-2: #2e7364;
      --accent-3: #d6b25e;
      --accent-4: #3b4cca;
      --shadow: 0 18px 45px rgba(24,34,45,.12);
      --radius: 24px;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 15% 20%, rgba(217,93,57,.18), transparent 28%),
        radial-gradient(circle at 85% 10%, rgba(46,115,100,.18), transparent 22%),
        radial-gradient(circle at 80% 80%, rgba(59,76,202,.12), transparent 24%),
        linear-gradient(180deg, #f8f5ee 0%, var(--bg) 100%);
      font-family: Georgia, "Noto Serif SC", serif;
    }

    .shell {
      max-width: 1380px;
      margin: 0 auto;
      padding: 28px 18px 60px;
    }

    .hero {
      display: grid;
      grid-template-columns: 1.4fr .9fr;
      gap: 18px;
      margin-bottom: 18px;
    }

    .hero-card, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      backdrop-filter: blur(16px);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }

    .hero-card {
      padding: 26px 28px;
      min-height: 220px;
      position: relative;
      overflow: hidden;
    }

    .hero-card::after {
      content: "";
      position: absolute;
      right: -30px;
      top: -10px;
      width: 180px;
      height: 180px;
      background: linear-gradient(135deg, rgba(217,93,57,.18), rgba(214,178,94,.08));
      border-radius: 50%;
    }

    .eyebrow {
      font: 600 12px/1.2 "Segoe UI", sans-serif;
      text-transform: uppercase;
      letter-spacing: .18em;
      color: var(--muted);
      margin-bottom: 16px;
    }

    h1 {
      margin: 0 0 14px;
      font-size: clamp(34px, 4vw, 58px);
      line-height: .98;
      max-width: 9ch;
    }

    .hero-copy {
      max-width: 58ch;
      color: var(--muted);
      font: 500 16px/1.65 "Segoe UI", sans-serif;
    }

    .hero-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
    }

    .metric {
      padding: 18px;
      border-radius: 22px;
      color: white;
      min-height: 128px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .metric:nth-child(1) { background: linear-gradient(135deg, #d95d39, #d7894f); }
    .metric:nth-child(2) { background: linear-gradient(135deg, #2e7364, #4e9482); }
    .metric:nth-child(3) { background: linear-gradient(135deg, #3b4cca, #6072e7); }
    .metric:nth-child(4) { background: linear-gradient(135deg, #212934, #465466); }

    .metric-label {
      font: 600 12px/1.2 "Segoe UI", sans-serif;
      text-transform: uppercase;
      letter-spacing: .14em;
      opacity: .82;
    }

    .metric-value {
      font-size: clamp(30px, 3vw, 42px);
      font-weight: 700;
      line-height: 1;
    }

    .metric-note {
      font: 500 13px/1.4 "Segoe UI", sans-serif;
      opacity: .9;
    }

    .grid {
      display: grid;
      grid-template-columns: 1.2fr .8fr;
      gap: 18px;
      margin-bottom: 18px;
    }

    .panel {
      padding: 22px;
    }

    .panel h2 {
      margin: 0 0 16px;
      font-size: 24px;
    }

    .muted {
      color: var(--muted);
      font: 500 13px/1.5 "Segoe UI", sans-serif;
    }

    .bars {
      display: grid;
      gap: 14px;
    }

    .bar-row {
      display: grid;
      grid-template-columns: 110px 1fr 56px;
      gap: 12px;
      align-items: center;
      font: 600 14px/1.3 "Segoe UI", sans-serif;
    }

    .bar-track {
      width: 100%;
      height: 12px;
      border-radius: 999px;
      background: rgba(24,34,45,.08);
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--accent-3));
    }

    .reply .bar-fill {
      background: linear-gradient(90deg, var(--accent-2), var(--accent-4));
    }

    .pending-list, .activity-list {
      display: grid;
      gap: 14px;
    }

    .lead-card, .activity-card {
      padding: 16px 18px;
      border-radius: 20px;
      background: rgba(255,255,255,.82);
      border: 1px solid rgba(24,34,45,.08);
    }

    .lead-head, .activity-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 8px;
    }

    .lead-title, .activity-title {
      font-size: 18px;
      margin: 0;
    }

    .badge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      font: 600 12px/1 "Segoe UI", sans-serif;
      background: rgba(24,34,45,.06);
      color: var(--ink);
    }

    .trend-chart {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 10px;
      align-items: end;
      min-height: 220px;
      margin-top: 10px;
    }

    .trend-col {
      display: grid;
      justify-items: center;
      gap: 8px;
    }

    .trend-bar {
      width: 100%;
      max-width: 56px;
      border-radius: 18px 18px 8px 8px;
      background: linear-gradient(180deg, #3b4cca, #d95d39);
      min-height: 10px;
      box-shadow: inset 0 -6px 10px rgba(255,255,255,.15);
    }

    .trend-count {
      font: 700 14px/1 "Segoe UI", sans-serif;
    }

    .trend-day {
      font: 600 12px/1.2 "Segoe UI", sans-serif;
      color: var(--muted);
    }

    .footer-note {
      margin-top: 10px;
      font: 500 12px/1.4 "Segoe UI", sans-serif;
      color: var(--muted);
    }

    @media (max-width: 980px) {
      .hero, .grid { grid-template-columns: 1fr; }
      .hero-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 640px) {
      .hero-metrics { grid-template-columns: 1fr; }
      .bar-row { grid-template-columns: 88px 1fr 40px; }
      .shell { padding: 16px 12px 40px; }
      .hero-card, .panel { border-radius: 20px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="hero">
      <div class="hero-card">
        <div class="eyebrow">Dynamic Dashboard</div>
        <h1 id="title">${title}</h1>
        <div class="hero-copy" id="hero-copy">载入中。</div>
      </div>
      <div class="hero-card hero-metrics">
        <div class="metric">
          <div class="metric-label">Open Leads</div>
          <div class="metric-value" id="open-count">0</div>
          <div class="metric-note" id="new-today">今日新增 0</div>
        </div>
        <div class="metric">
          <div class="metric-label">Replied</div>
          <div class="metric-value" id="replied-count">0</div>
          <div class="metric-note" id="new-7d">近 7 天新增 0</div>
        </div>
        <div class="metric">
          <div class="metric-label">Hot Leads</div>
          <div class="metric-value" id="hot-count">0</div>
          <div class="metric-note">分数 70 以上</div>
        </div>
        <div class="metric">
          <div class="metric-label">Avg Score</div>
          <div class="metric-value" id="avg-score">0</div>
          <div class="metric-note" id="total-count">总线索 0</div>
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="eyebrow">Pipeline Snapshot</div>
        <h2>待跟进队列</h2>
        <div class="pending-list" id="pending-list"></div>
      </div>
      <div class="panel">
        <div class="eyebrow">Distribution</div>
        <h2>类别分布</h2>
        <div class="bars" id="category-bars"></div>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <div class="eyebrow">Momentum</div>
        <h2>近 7 天线索趋势</h2>
        <div class="trend-chart" id="trend-chart"></div>
        <div class="footer-note" id="generated-at"></div>
      </div>
      <div class="panel">
        <div class="eyebrow">Execution</div>
        <h2>回复状态</h2>
        <div class="bars reply" id="reply-bars"></div>
      </div>
    </section>

    <section class="panel">
      <div class="eyebrow">Recent Activity</div>
      <h2>最新动态</h2>
      <div class="activity-list" id="activity-list"></div>
    </section>
  </div>

  <script>
    const state = {
      categoryLabels: {
        meeting: '会议',
        notification: '通知',
        marketing: '营销',
        security: '安全',
        test: '测试',
        general: '普通'
      }
    };

    const byId = (id) => document.getElementById(id);
    const compact = (text, limit = 120) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, limit) || '无';
    const label = (key) => state.categoryLabels[String(key || 'general').toLowerCase()] || key || '普通';
    const fmtTime = (value) => value ? new Date(value.replace(' ', 'T')).toLocaleString('zh-CN') : '无';

    function renderBars(container, rows) {
      if (!rows.length) {
        container.innerHTML = '<div class="muted">暂无数据</div>';
        return;
      }
      const max = Math.max(...rows.map(x => x.count), 1);
      container.innerHTML = rows.map(row => \`
        <div class="bar-row">
          <div>\${label(row.category || row.bucket)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:\${Math.max((row.count / max) * 100, 8)}%"></div></div>
          <div>\${row.count}</div>
        </div>
      \`).join('');
    }

    function renderTrend(container, rows) {
      if (!rows.length) {
        container.innerHTML = '<div class="muted">暂无趋势数据</div>';
        return;
      }
      const max = Math.max(...rows.map(x => x.count), 1);
      container.innerHTML = rows.map(row => {
        const h = Math.max((row.count / max) * 160, 12);
        const day = row.day.slice(5).replace('-', '/');
        return \`
          <div class="trend-col">
            <div class="trend-count">\${row.count}</div>
            <div class="trend-bar" style="height:\${h}px"></div>
            <div class="trend-day">\${day}</div>
          </div>
        \`;
      }).join('');
    }

    function renderPending(container, rows) {
      if (!rows.length) {
        container.innerHTML = '<div class="muted">当前没有待跟进线索。</div>';
        return;
      }
      container.innerHTML = rows.map(row => \`
        <article class="lead-card">
          <div class="lead-head">
            <h3 class="lead-title">#\${row.id} \${compact(row.subject, 46)}</h3>
            <strong>\${row.score || 0}</strong>
          </div>
          <div class="badge-row">
            <span class="badge">\${label(row.category)}</span>
            <span class="badge">\${compact(row.email, 24)}</span>
            <span class="badge">\${fmtTime(row.created_at)}</span>
          </div>
          <div class="muted">摘要：\${compact(row.summary, 140)}</div>
          <div class="muted">建议：\${compact(row.next_action, 90)}</div>
        </article>
      \`).join('');
    }

    function renderActivity(container, rows) {
      if (!rows.length) {
        container.innerHTML = '<div class="muted">暂无动态。</div>';
        return;
      }
      container.innerHTML = rows.map(row => \`
        <article class="activity-card">
          <div class="activity-head">
            <h3 class="activity-title">#\${row.id} \${compact(row.subject, 58)}</h3>
            <span class="muted">\${row.replied ? '已回复' : '待处理'}</span>
          </div>
          <div class="badge-row">
            <span class="badge">\${label(row.category)}</span>
            <span class="badge">分数 \${row.score || 0}</span>
            <span class="badge">\${compact(row.reply_result || 'pending', 16)}</span>
          </div>
          <div class="muted">摘要：\${compact(row.summary, 180)}</div>
          <div class="muted">创建：\${fmtTime(row.created_at)}，回复：\${fmtTime(row.replied_at)}</div>
        </article>
      \`).join('');
    }

    async function load() {
      const res = await fetch('/api/dashboard');
      const data = await res.json();

      byId('title').textContent = data.title;
      byId('hero-copy').textContent = \`当前共有 \${data.overview.total} 条线索，其中 \${data.overview.openCount} 条待处理，\${data.overview.hotCount} 条属于高热度。看板聚焦待跟进队列、回复效率和最近 7 天线索动量。\`;
      byId('open-count').textContent = data.overview.openCount;
      byId('replied-count').textContent = data.overview.repliedCount;
      byId('hot-count').textContent = data.overview.hotCount;
      byId('avg-score').textContent = data.overview.avgScore;
      byId('new-today').textContent = \`今日新增 \${data.overview.newToday}\`;
      byId('new-7d').textContent = \`近 7 天新增 \${data.overview.new7d}\`;
      byId('total-count').textContent = \`总线索 \${data.overview.total}\`;
      byId('generated-at').textContent = \`生成时间：\${new Date(data.generatedAt).toLocaleString('zh-CN')}，数据源：\${data.dbPath}\`;

      renderBars(byId('category-bars'), data.categoryBreakdown);
      renderBars(byId('reply-bars'), data.replyBreakdown);
      renderTrend(byId('trend-chart'), data.trend);
      renderPending(byId('pending-list'), data.pendingQueue);
      renderActivity(byId('activity-list'), data.recentActivity);
    }

    load().catch((err) => {
      byId('hero-copy').textContent = \`载入失败：\${err.message}\`;
    });
    setInterval(() => load().catch(() => {}), 30000);
  </script>
</body>
</html>`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, dbPath, title });
});

app.get('/api/dashboard', (_req, res) => {
  try {
    res.json(buildDashboardData());
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/', (_req, res) => {
  res.type('html').send(renderPage());
});

app.listen(port, () => console.log(`dynamic-dashboard running on :${port}`));
