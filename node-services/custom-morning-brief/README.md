# custom-morning-brief (Node)

1. Copy this folder to server: `/opt/custom-morning-brief`
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill values
4. Start with PM2:
   - `pm2 start /opt/custom-morning-brief/index.js --name custom-morning-brief --cwd /opt/custom-morning-brief`
   - `pm2 save`

Endpoints:
- `GET /health`
- `POST /run` (manual trigger)

Behavior:
- Reads `personal-crm` SQLite data
- Summarizes recent leads into a morning brief
- Sends the brief to WeCom through `wecom-bridge`
- Runs on `BRIEF_CRON`
