# TokyoClaw

`TokyoClaw` 是一套围绕 OpenClaw 搭建的销售线索处理与管理演示仓库。当前主链路已经统一到 `node-services/` 下，包含 5 个可独立部署的 Node 服务：

- `personal-crm`：邮箱线索抓取、AI 分析、回复草稿、人工/AI 回复
- `wecom-bridge`：企业微信回调桥接、命令入口、OpenClaw 聊天入口
- `custom-morning-brief`：按计划生成并推送销售晨报
- `dynamic-dashboard`：销售数据看板
- `agent-bridge`：给外部系统调用的 Agent HTTP 入口，可把消息路由到指定 OpenClaw agent

## 当前目录树

```text
claw/
├─ README.md
├─ DEPLOYMENT.md
├─ .env.example
├─ requirements.txt
├─ openclaw_projects_shortlist.md
├─ app/                          # 已弃用的 Python 原型，保留仅供参考
│  ├─ README.md
│  ├─ config.py
│  ├─ db.py
│  ├─ models.py
│  ├─ clients/
│  │  ├─ mail_client.py
│  │  ├─ openclaw_client.py
│  │  └─ wecom_client.py
│  └─ services/
│     └─ mail_processor.py
└─ node-services/
   ├─ agent-bridge/
   │  ├─ .env.example
   │  ├─ index.js
   │  ├─ package.json
   │  └─ README.md
   ├─ personal-crm/
   │  ├─ .env.example
   │  ├─ index.js
   │  ├─ package.json
   │  └─ README.md
   ├─ wecom-bridge/
   │  ├─ .env.example
   │  ├─ index.js
   │  ├─ package.json
   │  └─ README.md
   ├─ custom-morning-brief/
   │  ├─ .env.example
   │  ├─ index.js
   │  ├─ package.json
   │  └─ README.md
   └─ dynamic-dashboard/
      ├─ .env.example
      ├─ index.js
      ├─ package.json
      └─ README.md
```

## 项目简介

### 1. `node-services/personal-crm`

作用：

- 从邮箱抓取新邮件
- 调用 OpenClaw / OpenAI-compatible 接口做结构化分析
- 生成 `score / category / summary / next_action / reply_draft`
- 提供人工回复、AI 回复、重分析、拒绝处理
- 把新线索通知到企业微信

主要接口：

- `GET /health`
- `POST /poll`
- `GET /leads`
- `GET /lead/:id`
- `POST /lead/:id/reanalyze`
- `POST /reply/ai/:id`
- `POST /reply/manual/:id`
- `POST /lead/:id/reject`

### 2. `node-services/wecom-bridge`

作用：

- 提供企业微信加密回调入口
- 把企业微信消息路由到内部命令或 OpenClaw 聊天
- 接收 `personal-crm` 和 `custom-morning-brief` 的内部通知
- 给企业微信返回整洁文本，而不是原始模型输出

主要接口：

- `GET /health`
- `GET /wecom/callback`
- `POST /wecom/callback`
- `POST /notify/new-lead`
- `POST /notify/text`

当前已接入命令包括：

- `help`
- `status`
- `poll`
- `dashboard`
- `leads`
- `draft <id>`
- `reanalyze <id>`
- `approve <id>`
- `confirm approve <id>`
- `reply <id> <内容>`
- `reject <id>`

### 3. `node-services/custom-morning-brief`

作用：

- 读取 `personal-crm` 的 SQLite 数据
- 汇总最近线索、重点跟进项、风险提醒
- 生成销售团队晨报
- 通过 `wecom-bridge` 推送到企业微信

主要接口：

- `GET /health`
- `POST /run`

### 4. `node-services/dynamic-dashboard`

作用：

- 读取 `personal-crm` 的 SQLite 数据
- 输出一套轻量的 Web 管理看板
- 展示 KPI、分类分布、回复状态、趋势、待跟进队列、最近活动

主要接口：

- `GET /health`
- `GET /api/dashboard`
- `GET /`

### 5. `node-services/agent-bridge`

作用：

- 提供一个最小 HTTP API，供外部系统主动调用指定 OpenClaw agent
- 以 `conversation_id` 作为会话隔离键，避免不同客户串上下文
- 当前适合个微 / 外部机器人平台把消息转给固定业务 agent，例如 `snowchuang`

主要接口：

- `GET /health`
- `POST /api/agents/chat`
- `POST /api/agents/:agentId/chat`

## 服务关系

```text
Mailbox
  -> personal-crm
     -> OpenClaw Gateway (:8080) for analysis / draft generation
     -> wecom-bridge for lead notifications

Enterprise WeChat
  -> wecom-bridge
     -> personal-crm for CRM commands
     -> OpenClaw Gateway (:8080) for chat fallback

custom-morning-brief
  -> personal-crm SQLite
  -> wecom-bridge

dynamic-dashboard
  -> personal-crm SQLite

External systems / personal WeChat platform
  -> agent-bridge
     -> OpenClaw agent CLI
```

## 当前推荐部署方式

服务器上统一使用一个仓库目录：

- `/opt/claw/node-services/personal-crm`
- `/opt/claw/node-services/wecom-bridge`
- `/opt/claw/node-services/custom-morning-brief`
- `/opt/claw/node-services/dynamic-dashboard`
- `/opt/claw/node-services/agent-bridge`

不要再维护老的重复目录，例如：

- `/opt/personal-crm`
- `/opt/wecom-bridge`

完整部署步骤见：

- [DEPLOYMENT.md](d:\Study\claw\DEPLOYMENT.md)

## 运行依赖

### Node 主链路

当前生产链路是 Node 服务，建议使用：

- Node.js 22
- PM2

### OpenClaw Gateway

当前仓库中的多个服务依赖本机 OpenClaw Gateway：

- 默认地址：`http://127.0.0.1:8080/v1`

典型依赖点：

- `personal-crm` 的邮件分析与草稿生成
- `wecom-bridge` 的普通聊天兜底
- 浏览器控制能力

### 已弃用 Python 原型代码

根目录 `app/` 是较早的一版 Python 原型，当前状态是：

- 已弃用
- 不参与当前生产部署
- 不在 PM2 主链路中运行
- 仅保留作早期实现参考，避免丢失设计思路

该目录包含：

- 邮件客户端
- OpenClaw 客户端
- 企业微信客户端
- 邮件处理逻辑

后续开发、部署和排障应优先以 `node-services/` 为准，不要再基于 `app/` 继续扩展功能。

## 常用维护动作

### 更新服务器代码

```bash
cd /opt/claw
git pull
```

### 安装依赖

```bash
cd /opt/claw/node-services/personal-crm && npm install
cd /opt/claw/node-services/wecom-bridge && npm install
cd /opt/claw/node-services/custom-morning-brief && npm install
cd /opt/claw/node-services/dynamic-dashboard && npm install
cd /opt/claw/node-services/agent-bridge && npm install
```

### 重启服务

```bash
pm2 restart personal-crm --update-env
pm2 restart wecom-bridge --update-env
pm2 restart custom-morning-brief --update-env
pm2 restart dynamic-dashboard --update-env
pm2 restart agent-bridge --update-env
```

### 查看状态

```bash
pm2 status
curl -sS http://127.0.0.1:9030/health
curl -sS http://127.0.0.1:9050/health
curl -sS http://127.0.0.1:9040/health
curl -sS http://127.0.0.1:9060/health
curl -sS http://127.0.0.1:9070/health
```

## 参考文件

- [DEPLOYMENT.md](d:\Study\claw\DEPLOYMENT.md)
- [openclaw_projects_shortlist.md](d:\Study\claw\openclaw_projects_shortlist.md)
- [legacy app README](d:\Study\claw\app\README.md)
- [personal-crm README](d:\Study\claw\node-services\personal-crm\README.md)
- [wecom-bridge README](d:\Study\claw\node-services\wecom-bridge\README.md)
- [custom-morning-brief README](d:\Study\claw\node-services\custom-morning-brief\README.md)
- [dynamic-dashboard README](d:\Study\claw\node-services\dynamic-dashboard\README.md)
- [agent-bridge README](d:\Study\claw\node-services\agent-bridge\README.md)
