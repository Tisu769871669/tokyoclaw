# wecom-bridge (Node, encrypted callback mode)

1. Copy this folder to server: `/opt/wecom-bridge`
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill values
4. Start with PM2:
   - `pm2 start /opt/wecom-bridge/index.js --name wecom-bridge --cwd /opt/wecom-bridge`
   - `pm2 save`

Endpoints:
- `GET /health`
- `GET /wecom/callback` (WeCom URL verify)
- `POST /wecom/callback` (encrypted callback)
- `POST /notify/new-lead` (internal notify from personal-crm)
- `POST /notify/text` (generic internal text notify)

Extra env for chat fallback:
- `DASHBOARD_URL` (dashboard link returned by `dashboard` command)
- `OPENCLAW_BASE_URL` (default `http://127.0.0.1:8080/v1`)
- `OPENCLAW_API_KEY` (optional, set if gateway requires bearer token)
- `OPENCLAW_MODEL` (default `openclaw`)

Behavior:
- Command text (`status/poll/dashboard/leads/approve/reply/reject`) -> handled as control command
- Other text -> forwarded to OpenClaw chat API and sent back as a cleaned final reply (plus an immediate "processing" notice)
