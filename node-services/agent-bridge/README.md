# agent-bridge

`agent-bridge` exposes a minimal HTTP API for upstream systems to talk to a specific OpenClaw agent.

Current MVP:

- `POST /api/agents/:agentId/chat`
- required JSON fields: `conversation_id`, `message`, `user_id`
- bearer auth via `AGENT_BRIDGE_TOKEN`
- maps each `conversation_id` to a stable OpenClaw `session_id`

Example request:

```bash
curl -X POST http://127.0.0.1:9070/api/agents/snowchuang/chat \
  -H "Authorization: Bearer replace_me" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "wxid_o8abc123",
    "message": "你好，想咨询一下价格",
    "user_id": "wxid_o8abc123"
  }'
```

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
