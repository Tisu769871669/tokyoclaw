---
name: xuechuang-ordering
description: Query Snowchuang Ordering API for member users and member order pages. Use for snowchuang, 雪创, 订货通, 会员用户, 用户列表, 客户订单, 订单列表, 订单状态, 收货地址, 支付金额, and questions that need live mall.xuechuang.biz MCP data.
metadata: { "openclaw": { "emoji": "❄️", "primaryEnv": "XCDHT_MCP_SECRET", "requires": { "env": ["XCDHT_MCP_KEY", "XCDHT_MCP_SECRET"] } } }
---

# Xuechuang Ordering

Use this skill when the snowchuang agent needs live member or order data from Snowchuang Ordering.

## Guardrails

- Do not reveal `XCDHT_MCP_KEY`, `XCDHT_MCP_SECRET`, raw headers, or server-side credential config in replies.
- Query the minimum page size needed for the user's request. Prefer `pageSize` 10-20 unless the user asks for a larger export.
- Treat returned names, phones, addresses, IPs, and order details as private customer data. Summarize only what is needed for the current customer-service task.
- If credentials are missing, say the Snowchuang Ordering API credentials are not configured for this agent and stop.

## Quick Commands

Use the helper script first; it reads credentials from environment variables injected by OpenClaw.

```bash
python3 "{baseDir}/scripts/xcdht_api.py" users --page-no 1 --page-size 20
python3 "{baseDir}/scripts/xcdht_api.py" orders --user-id 23788 --page-no 1 --page-size 20
```

If the host only has `python`, use the same command with `python`.

## Workflow

1. Identify whether the user is asking for members or orders.
2. For member lookup/listing, call `users`. Use the returned `id` as `userId` for follow-up order queries.
3. For order lookup/listing, call `orders --user-id <id>`.
4. Read `references/api.md` when field meanings, status mapping, or endpoint details are needed.
5. Convert money-like integer fields from cents/fen only when the field description says the unit is fen. Otherwise preserve the API value and avoid guessing.
6. Answer in customer-service language: concise, task-focused, and without dumping full raw JSON unless explicitly requested by an authorized operator.

## Configuration

The snowchuang OpenClaw agent should have these variables available at runtime:

```bash
XCDHT_MCP_KEY=...
XCDHT_MCP_SECRET=...
```

Optional override:

```bash
XCDHT_MCP_BASE_URL=https://mall.xuechuang.biz/app-api/mcp/api-mcp
```

For OpenClaw config injection, set them under `skills.entries.xuechuang-ordering.env` for the snowchuang agent or export them in the service environment that starts OpenClaw.
