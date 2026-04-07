# 子 Agent API 调用文档

本文档用于说明当前东京龙虾服务器上两个子 Agent 的调用方式：

- `snowchuang`
- `yixiang`

两个 Agent 的调用协议完全一致，仅请求地址不同。

## 一、接口地址

### 1. 雪创 Agent

```http
POST https://tokyoclaw.metast.cn/api/agents/snowchuang/chat
```

### 2. 颐享 Agent

```http
POST https://tokyoclaw.metast.cn/api/agents/yixiang/chat
```

## 二、请求头

```http
Authorization: Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848
Content-Type: application/json; charset=utf-8
```

说明：

- 请求体必须使用 `UTF-8`
- `Authorization` 使用固定 Bearer Token

## 三、请求参数

### 参数列表

| 参数名 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `conversationId` | string | 是 | 会话 ID。同一个用户必须固定同一个值，用于维持上下文连续性。 |
| `conversation_id` | string | 否 | `conversationId` 的兼容别名，建议新系统统一使用 `conversationId`。 |
| `userId` | string | 否 | 用户唯一标识。当前不是必填。 |
| `user_id` | string | 否 | `userId` 的兼容别名。 |
| `message` | string | 否 | 直接传本轮用户消息。 |
| `content` | string/object | 否 | 可以直接是一段文本，也可以是消息对象。 |
| `content.messageList` | array | 否 | 最近几轮聊天记录。 |
| `content.messageList[].role` | string | 否 | 消息角色，建议传 `user` 或 `assistant`。 |
| `content.messageList[].text` | string | 否 | 消息文本内容。 |

### 参数生效规则

请求中：

- `conversationId` 或 `conversation_id` 至少要有一个
- 以下三种任意一种能提取出消息即可：
  - `message`
  - `content` 字符串
  - `content.messageList`

### 消息提取规则

服务端当前处理逻辑如下：

1. 如果存在 `message`，优先使用 `message`
2. 如果 `content` 是字符串，则直接把它当作本轮用户消息
3. 如果存在 `content.messageList`，则从后往前查找最后一条用户消息作为本轮输入
4. 如果找不到明确 `role=user` 的消息，则从后往前取最后一条可读文本
5. `messageList` 中最近几轮聊天记录会作为辅助上下文传给 Agent

## 四、推荐请求格式

### 1. 最简格式

```json
{
  "conversationId": "session_001",
  "content": "你好，介绍一下你能做什么"
}
```

### 2. 带最近几轮上下文

```json
{
  "conversationId": "session_002",
  "content": {
    "messageList": [
      { "role": "assistant", "text": "您好，今天想看什么？" },
      { "role": "user", "text": "我想先了解一下会员" },
      { "role": "assistant", "text": "好的呀，您最想了解哪一块呢？" },
      { "role": "user", "text": "会员费是多少？" }
    ]
  }
}
```

### 3. 使用 `message` 字段

```json
{
  "conversationId": "session_003",
  "message": "物流运费多少钱一公斤？"
}
```

## 五、成功返回结果

### 返回字段

| 字段名 | 类型 | 说明 |
|---|---|---|
| `ok` | boolean | 是否成功 |
| `agent_id` | string | 当前调用的 Agent ID |
| `conversation_id` | string | 回显请求里的会话 ID |
| `user_id` | string | 回显请求里的用户 ID，如果未传则通常为空字符串 |
| `reply` | string | Agent 最终生成的回复文本 |
| `session_id` | string | 服务内部生成的会话 ID |
| `trace_id` | string | 调试追踪 ID |

### 成功返回示例

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "conversation_id": "session_001",
  "user_id": "",
  "reply": "亲亲好呀～ 我是雪创的专属客服❄️\n\n帮您挑款、查价格、跟订单、管售后，购物相关的事都能找我！简单说就是让您买得省心～\n\n今天想看什么？直接跟我说就行😊🌹",
  "session_id": "bridge_snowchuang_session_001",
  "trace_id": "5952a2ee-0ecb-40b6-a21e-b93afd94a8ed"
}
```

## 六、失败返回结果

### 失败返回示例

```json
{
  "ok": false,
  "error": "invalid_request",
  "message": "conversationId is required",
  "trace_id": "b84d2e69-c6d6-4fd5-a4c9-0d9a7e8d6e6a"
}
```

### 常见错误

| error | 说明 |
|---|---|
| `unauthorized` | Token 缺失或不正确 |
| `invalid_request` | 请求参数不完整或格式不正确 |
| `agent_execution_failed` | Agent 执行失败，可结合 `trace_id` 排查 |

## 七、上下文规则

- 同一个用户必须固定使用同一个 `conversationId`
- `conversationId` 是主上下文键
- `messageList` 是辅助上下文，不是必填
- 服务端会把 `conversationId` 映射成内部 `session_id`

### 示例

如果请求：

```json
{
  "conversationId": "session_001"
}
```

服务端可能生成：

```text
bridge_snowchuang_session_001
```

或：

```text
bridge_yixiang_session_001
```

这取决于当前调用的是哪个 Agent。

## 八、PowerShell 调用示例

### 雪创

```powershell
$body = @{
  conversationId = "session_001"
  content = "你好，介绍一下你能做什么"
} | ConvertTo-Json -Depth 6

$utf8 = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
  -Method Post `
  -Uri "https://tokyoclaw.metast.cn/api/agents/snowchuang/chat" `
  -Headers @{ Authorization = "Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $utf8
```

### 颐享

```powershell
$body = @{
  conversationId = "session_001"
  content = "你好，介绍一下你能做什么"
} | ConvertTo-Json -Depth 6

$utf8 = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
  -Method Post `
  -Uri "https://tokyoclaw.metast.cn/api/agents/yixiang/chat" `
  -Headers @{ Authorization = "Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $utf8
```

## 九、cURL 调用示例

### 雪创

```bash
curl -X POST "https://tokyoclaw.metast.cn/api/agents/snowchuang/chat" \
  -H "Authorization: Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{
    "conversationId": "session_001",
    "content": "你好，介绍一下你能做什么"
  }'
```

### 颐享

```bash
curl -X POST "https://tokyoclaw.metast.cn/api/agents/yixiang/chat" \
  -H "Authorization: Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{
    "conversationId": "session_001",
    "content": "你好，介绍一下你能做什么"
  }'
```
