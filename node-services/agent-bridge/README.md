# agent-bridge

`agent-bridge` exposes a minimal HTTP API for upstream systems to talk to a specific OpenClaw agent.

Current MVP:

- `POST /api/agents/:agentId/chat`
- required JSON fields: `conversationId`, and one of: `message` / `content`(string) / `content.messageList`
- friend approval payloads with `status=1`, `sendId`, `recvId`, `conversationId`, and `tenantId` are sent through the configured WeChat message API directly and return `204 No Content`
- bearer auth via `AGENT_BRIDGE_TOKEN`
- maps each `agentId + conversationId` to isolated bridge-owned history
- supports lightweight local retrieval from `客服回复优化.txt` before calling the agent
- can bind a Snowchuang WeChat conversation to an ordering member phone when the request includes an order `userId`
- calls OpenClaw with a per-request run session by default, or routes execution through `AGENT_POOL_BRIDGE_URL` when configured

Example request:

```bash
curl -X POST http://127.0.0.1:9070/api/agents/snowchuang/chat \
  -H "Authorization: Bearer replace_me" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "wxid_o8abc123",
    "content": {
      "messageList": [
        { "role": "user", "text": "你好，想咨询一下价格" }
      ]
    }
  }'
```

Backward compatible aliases are still accepted:

- `content` can be a plain string message
- `conversation_id`
- `user_id`
- `message`

Example success response:

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "conversation_id": "wxid_o8abc123",
  "user_id": "wxid_o8abc123",
  "reply": "亲亲在的呀😊 想了解哪款呢？我可以帮您看看~",
  "session_id": "bridge:snowchuang:wxid_o8abc123",
  "trace_id": "2f9b1c44-93f5-4eb7-8b17-b3bdc5999f12"
}
```

Friend approval welcome request:

```bash
curl -i -X POST http://127.0.0.1:9070/api/agents/snowchuang/chat \
  -H "Authorization: Bearer replace_me" \
  -H "Content-Type: application/json" \
  -d '{
    "status": 1,
    "sendId": "new-user-wxid",
    "recvId": "service-wxid",
    "conversationId": "wxid_o8abc123",
    "tenantId": "125"
  }'
```

For this event, `agent-bridge` calls `FRIEND_WELCOME_SEND_URL` with the original `sendId`, `recvId`, and `tenantId`, resolves the matching tenant credentials and welcome content from `FRIEND_WELCOME_TENANT_CREDENTIALS`, then returns `204 No Content` without calling the agent.

Endpoints:

- `GET /health`
- `POST /api/agents/:agentId/chat`
- `POST /api/agents/chat` (uses `DEFAULT_AGENT_ID`)

Local knowledge base:

- default file: `客服回复优化.txt`
- parsed as FAQ entries at service startup
- top matches are injected as hidden context for the current turn

Agent pool backend:

- Set `AGENT_POOL_BRIDGE_URL=http://127.0.0.1:9071` to keep this Snowchuang bridge as the public business adapter while sending actual agent execution through the generic worker pool.
- Set `AGENT_POOL_BRIDGE_TOKEN` to the token configured on the pool bridge.
- Friend approval welcome events still short-circuit locally and do not call the pool.

Wxid phone binding:

- Enabled by default. Set `WXID_BINDING_ENABLED=0` to disable it.
- When a normal chat payload includes `orderUserId`, `memberUserId`, `xcdhtUserId`, `order.userId`, or `orders[].userId`, the bridge treats that value as the Snowchuang ordering member `userId`.
- The current wxid is taken from `wxid`, `wechatId`, `sendId`, or falls back to `conversationId`.
- The bridge calls the local `xuechuang-ordering` helper with `user --user-id <id>`, extracts phone fields such as `mobile`, `phone`, `userMobile`, `loginMobile`, or `tel`, and stores the binding locally.
- Default binding store: `.sessions/wxid-bindings.json`. Override with `WXID_BINDING_STORE_FILE`.
- If the lookup fails or the user profile has no phone field, the chat request still proceeds normally.

Session isolation:

- default store: `.sessions`
- key scope: `agentId + conversationId`
- default retained history: last 20 normalized messages
- OpenClaw internal session id is per request; bridge history is the source of conversation continuity
