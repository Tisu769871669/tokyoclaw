# 雪创 Agent HTTP 接口说明

本文档用于第三方系统对接东京龙虾上的 `snowchuang` 专属 Agent。

## 接口地址

```http
POST http://tokyoclaw.metast.cn:9070/api/agents/snowchuang/chat
```

## 请求头

```http
Authorization: Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848
Content-Type: application/json; charset=utf-8
```

说明：

- 请求体必须使用 `UTF-8` 编码。
- `Authorization` 使用固定 Bearer Token。

## 请求体

### 当前推荐格式

```json
{
  "conversationId": "session_005",
  "userId": "user_001",
  "content": {
    "messageList": [
      {
        "role": "user",
        "text": "你好，介绍一下你能做什么"
      }
    ]
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `conversationId` | string | 是 | 会话 ID。同一个用户必须保持稳定，系统会基于它维持上下文连续性。 |
| `userId` | string | 是 | 用户唯一标识。 |
| `content` | object | 是 | 消息内容对象。 |
| `content.messageList` | array | 是 | 消息列表。当前系统会优先取列表中最后一条用户消息作为本轮输入。 |
| `content.messageList[].role` | string | 否 | 消息角色。建议用户消息传 `user`。 |
| `content.messageList[].text` | string | 否 | 消息文本内容。 |

## 消息提取规则

系统当前处理规则如下：

1. 优先读取 `content.messageList`
2. 从后往前查找最后一条用户消息
3. 如果找不到明确 `role=user` 的消息，则从后往前取最后一条可读文本

因此建议调用方始终保证：

- 最新一条用户消息放在 `messageList` 末尾
- 用户消息的 `role` 显式传 `user`

## 返回示例

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "conversation_id": "session_005",
  "user_id": "user_001",
  "reply": "亲亲好～ 我是雪创的专属客服助手❄️\n\n能帮您搞定购物全流程：\n\n- 挑款式\n- 解疑惑\n- 算优惠\n- 查订单\n- 保售后\n\n您今天有什么想了解的？直接跟我说就行！😊",
  "session_id": "bridge_snowchuang_session_005",
  "trace_id": "2cf96b2f-b04f-4484-bb4f-4317c3321139"
}
```

## 返回字段说明

| 字段 | 类型 | 说明 |
|---|---|---|
| `ok` | boolean | 是否成功 |
| `agent_id` | string | 当前调用的 agent，固定为 `snowchuang` |
| `conversation_id` | string | 回显调用方传入的 `conversationId` |
| `user_id` | string | 回显调用方传入的 `userId` |
| `reply` | string | Agent 生成的最终回复文本。调用方只需要把该字段发回微信即可。 |
| `session_id` | string | 服务内部生成的会话 ID |
| `trace_id` | string | 调试追踪 ID |

## 错误返回示例

```json
{
  "ok": false,
  "error": "invalid_request",
  "message": "conversationId is required",
  "trace_id": "b84d2e69-c6d6-4fd5-a4c9-0d9a7e8d6e6a"
}
```

常见错误：

- `unauthorized`
  说明：Bearer Token 缺失或不正确
- `invalid_request`
  说明：请求参数缺失或格式不符合要求
- `agent_execution_failed`
  说明：Agent 执行失败，可结合 `trace_id` 排查

## 调用建议

- 同一个微信用户请固定使用同一个 `conversationId`
- 请求体请始终使用 `UTF-8`
- 调用方最终只需要取返回中的 `reply` 发回微信
- 如需排查问题，请保留 `trace_id`

## PowerShell 调用示例

```powershell
$body = @{
  conversationId = "session_005"
  userId = "user_001"
  content = @{
    messageList = @(
      @{
        role = "user"
        text = "你好，介绍一下你能做什么"
      }
    )
  }
} | ConvertTo-Json -Depth 6

$utf8 = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
  -Method Post `
  -Uri "http://tokyoclaw.metast.cn:9070/api/agents/snowchuang/chat" `
  -Headers @{ Authorization = "Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $utf8
```

## cURL 调用示例

```bash
curl -X POST "http://tokyoclaw.metast.cn:9070/api/agents/snowchuang/chat" \
  -H "Authorization: Bearer 4c9b8164f63f04cd42025d3739ed75b439596fcfba389848" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary '{
    "conversationId": "session_005",
    "userId": "user_001",
    "content": {
      "messageList": [
        {
          "role": "user",
          "text": "你好，介绍一下你能做什么"
        }
      ]
    }
  }'
```
