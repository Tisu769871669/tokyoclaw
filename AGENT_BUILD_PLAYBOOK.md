# Agent 制作流程与步骤

本文档用于复刻我们当前“雪创专属 Agent”的制作方式，也适用于在另一台 OpenClaw 服务器上把 `main` agent 改造成目标业务 agent。

## 目标

把 OpenClaw 服务器上的某个 agent 做成“专属业务客服 agent”，并通过 HTTP 接口对外提供聊天能力，支持：

- 固定 `conversationId` 维持上下文
- 可选传 `messageList` 作为最近几轮聊天上下文
- 可选本地知识库增强回复

## 一、整体流程

1. 确认目标服务器 OpenClaw 可用
2. 确认是做独立 agent 还是直接使用 `main`
3. 配置 agent 身份与职责
4. 配置知识库与局部 skills
5. 部署 `agent-bridge`
6. 打通本机测试
7. 打通公网/域名测试
8. 输出给第三方的接口文档

## 二、前置检查

在目标服务器执行：

```bash
openclaw --version
openclaw agents --help
openclaw agents list
openclaw agent --help
```

确认以下事项：

- OpenClaw CLI 正常可用
- 当前 agent 可被调用
- 模型 provider 已配置完成
- `openclaw agent --agent xxx --message "你好"` 能正常返回结果

## 三、方案选择

### 方案 A：独立子 agent

适用于：

- 需要和 `main` 隔离
- 需要独立 workspace / identity / skills / knowledge
- 多业务线并存

创建方式：

```bash
mkdir -p ~/.openclaw/workspace-youragent

openclaw agents add youragent \
  --workspace ~/.openclaw/workspace-youragent \
  --model <你的模型ID> \
  --non-interactive
```

### 方案 B：直接改造 `main` agent

适用于：

- 另一台服务器只服务一个业务
- 不需要多 agent 隔离
- 目标是最快上线

`main` 的 workspace 一般是：

```bash
~/.openclaw/workspace
```

这种情况下不用 `agents add`，直接改 `main` 的 workspace 内容即可。

### 两种方案的区别

- 独立 agent：改 `~/.openclaw/workspace-youragent`
- `main` agent：改 `~/.openclaw/workspace`

## 四、配置 agent 身份

最少要准备两个文件：

1. `IDENTITY.md`
2. `SOUL.md`

### `IDENTITY.md` 示例

```md
# IDENTITY.md

Name: 雪创客服助手
Creature: 雪创专属带货客服
Vibe: 热情、专业、有成交意识
Emoji: ❄️
Avatar:
```

### `SOUL.md` 内容建议

建议至少包含：

- 角色定位
- 语气风格
- 回复边界
- 成交导向
- 不暴露 AI 身份
- 资料不足时的兜底规则

### 文件放置位置

如果是 `main` agent，把文件放到：

```bash
~/.openclaw/workspace/
```

如果是独立 agent，把文件放到：

```bash
~/.openclaw/workspace-youragent/
```

## 五、配置知识库

当前推荐使用“轻量本地知识库”方案，而不是外部向量库。

### 方案特点

- 上线快
- 简单可控
- 易于维护
- 足以覆盖 FAQ 型业务知识

### 做法

1. 准备 FAQ / 业务资料文本
2. 放到 `agent-bridge` 所在目录，或指定绝对路径
3. 服务启动时读取并解析
4. 对用户问题做本地匹配
5. 把命中的条目作为隐藏上下文注入给 agent

### 示例知识库文件

- `客服回复优化.txt`

### 适合放入知识库的内容

- 常见问答
- 会员规则
- 价格说明
- 物流与售后
- 平台能力说明

## 六、配置局部 skills

如果该 agent 需要自己的专属 skills，不要放在共享目录，而要放在该 agent 自己的 workspace 下。

### 独立 agent

```bash
~/.openclaw/workspace-youragent/skills/
```

### `main` agent

```bash
~/.openclaw/workspace/skills/
```

### 适合做成 skill 的内容

- 专属业务规则
- 专属查询流程
- 文件读取约定
- 专属操作 SOP

## 七、部署 HTTP 桥接服务

当前推荐使用 `node-services/agent-bridge` 对外提供 HTTP 入口。

### 核心作用

- 接收第三方 `POST`
- 根据 `conversationId` 映射 OpenClaw 会话
- 调用 `openclaw agent`
- 返回 `reply`

### 关键环境变量

```env
PORT=9070
AGENT_BRIDGE_TOKEN=your_secret
OPENCLAW_BIN=openclaw
DEFAULT_AGENT_ID=snowchuang
AGENT_TIMEOUT_SECONDS=120
KNOWLEDGE_FILE=客服回复优化.txt
KB_TOP_K=3
KB_MIN_SCORE=3
```

### 如果目标是另一台服务器的 `main` agent

最关键的是改成：

```env
DEFAULT_AGENT_ID=main
```

这样对外默认调用的就是 `main`。

## 八、HTTP 接口协议

### 地址

显式指定 agent：

```http
POST http://<域名或IP>:9070/api/agents/<agentId>/chat
```

使用默认 agent：

```http
POST http://<域名或IP>:9070/api/agents/chat
```

### 当前最小可用协议

- `conversationId` 必填
- `messageList` 可选
- 以下三种任意一种有值即可：
  - `message`
  - `content` 字符串
  - `content.messageList`

### 推荐格式

```json
{
  "conversationId": "session_001",
  "content": {
    "messageList": [
      { "role": "assistant", "text": "您好，今天想看什么款呢？" },
      { "role": "user", "text": "介绍一下你能做什么" }
    ]
  }
}
```

### 最简格式

```json
{
  "conversationId": "session_001",
  "content": "介绍一下你能做什么"
}
```

## 九、上下文策略

当前上下文策略如下：

- `conversationId` 是主上下文键
- 同一个用户必须固定同一个 `conversationId`
- `messageList` 是辅助上下文，不是唯一上下文来源
- 服务会把 `messageList` 最近几轮一起带给 agent

### 一句话解释

`conversationId` 负责长期会话连续性，`messageList` 负责本轮补充上下文。

## 十、测试步骤

### 1. 本机健康检查

```bash
curl -sS http://127.0.0.1:9070/health
```

### 2. 本机聊天测试

```bash
curl -sS -X POST http://127.0.0.1:9070/api/agents/chat \
  -H "Authorization: Bearer your_secret" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{
    "conversationId": "test_001",
    "content": "会员费是多少？"
  }'
```

### 3. 公网测试

```bash
curl -sS -X POST http://your-domain:9070/api/agents/chat \
  -H "Authorization: Bearer your_secret" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{
    "conversationId": "test_002",
    "content": "会员费是多少？"
  }'
```

### 4. 知识库测试

建议使用 FAQ 明确命中的问题，例如：

- `会员费是多少？`
- `物流运费多少钱一公斤？`

## 十一、上线检查清单

- OpenClaw CLI 正常
- agent 能单独回复
- `IDENTITY.md` 已配置
- `SOUL.md` 已配置
- 知识库文件已加载
- `/health` 正常
- HTTP 鉴权正常
- 域名/IP 外网可访问
- 第三方联调通过

## 十二、如果目标是另一台服务器的 `main` agent

把上面流程里这几项替换掉：

### 1. 不执行

```bash
openclaw agents add youragent ...
```

### 2. 直接使用

```bash
~/.openclaw/workspace
```

### 3. 把以下内容放到 `main` 的 workspace

- `IDENTITY.md`
- `SOUL.md`
- `skills/`

### 4. `agent-bridge` 的 `.env` 里改成

```env
DEFAULT_AGENT_ID=main
```

### 5. 对外接口直接用

```http
POST /api/agents/chat
```

这样第三方不需要感知你内部是不是子 agent，桥接层统一处理。

## 十三、给另一个线程的任务描述

可以直接发下面这段：

```text
请在另一台 OpenClaw 服务器上复刻我们当前 snowchuang agent 的制作流程，但目标不是创建独立 agent，而是把该服务器的 main agent 改造成目标业务 agent。

要求：
1. 使用 main agent，不新建 isolated agent
2. 配置 main agent 的 IDENTITY.md 和 SOUL.md
3. 如有专属 skills，放到 main workspace 的 skills 目录
4. 部署 agent-bridge，并把 DEFAULT_AGENT_ID 设为 main
5. 接入本地知识库文件
6. 打通 /health、本机 POST、公网 POST
7. 输出可给第三方联调的接口文档
```
