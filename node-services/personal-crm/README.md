# personal-crm (Node)

1. Copy this folder to server: `/opt/personal-crm`
2. Run `npm install`
3. Copy `.env.example` to `.env` and fill values
4. Start with PM2:
   - `pm2 start /opt/personal-crm/index.js --name personal-crm --cwd /opt/personal-crm`
   - `pm2 save`

APIs:
- `GET /health`
- `POST /poll` (async trigger)
- `GET /leads`
- `POST /lead/:id/reanalyze`
- `POST /reply/ai/:id`
- `POST /reply/manual/:id` body: `{ "content": "..." }`
- `POST /lead/:id/reject`
