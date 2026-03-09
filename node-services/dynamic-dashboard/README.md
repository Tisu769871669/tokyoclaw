# dynamic-dashboard (Node)

1. Copy this folder to server: `/opt/claw/node-services/dynamic-dashboard`
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill values
4. Start with PM2:
   - `pm2 start /opt/claw/node-services/dynamic-dashboard/index.js --name dynamic-dashboard --cwd /opt/claw/node-services/dynamic-dashboard`
   - `pm2 save`

Endpoints:
- `GET /health`
- `GET /api/dashboard`
- `GET /`

Behavior:
- Reads `personal-crm` SQLite data
- Shows KPI cards, category distribution, priority queues, reply status, and recent lead activity
