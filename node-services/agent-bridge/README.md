# agent-bridge

`agent-bridge` exposes a minimal HTTP API for upstream systems to talk to a specific OpenClaw agent.

Current MVP:

- `POST /api/agents/:agentId/chat`
- required JSON fields: `conversationId`, and one of: `message` / `content`(string) / `content.messageList`
- bearer auth via `AGENT_BRIDGE_TOKEN`
- maps each `agentId + conversationId` to isolated bridge-owned history
- supports lightweight local retrieval from `客服回复优化.txt` before calling the agent
- calls OpenClaw with a per-request run session to avoid cross-user internal context bleed

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

Endpoints:

- `GET /health`
- `POST /api/agents/:agentId/chat`
- `POST /api/agents/chat` (uses `DEFAULT_AGENT_ID`)

Local knowledge base:

- default file: `客服回复优化.txt`
- parsed as FAQ entries at service startup
- top matches are injected as hidden context for the current turn

Session isolation:

- default store: `.sessions`
- key scope: `agentId + conversationId`
- default retained history: last 20 normalized messages
- OpenClaw internal session id is per request; bridge history is the source of conversation continuity
