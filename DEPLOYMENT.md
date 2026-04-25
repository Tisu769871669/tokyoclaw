# Deployment

## Target layout

Use a single repo checkout on the server:

- `/opt/claw/node-services/personal-crm`
- `/opt/claw/node-services/wecom-bridge`
- `/opt/claw/node-services/custom-morning-brief`
- `/opt/claw/node-services/dynamic-dashboard`
- `/opt/claw/node-services/agent-bridge`

Do not maintain duplicate app copies under `/opt/personal-crm` or `/opt/wecom-bridge`.

## Initial clone

```bash
cd /opt
git clone <YOUR_GITHUB_REPO_URL> claw
cd /opt/claw
```

## Install dependencies

```bash
cd /opt/claw/node-services/personal-crm
npm install

cd /opt/claw/node-services/wecom-bridge
npm install

cd /opt/claw/node-services/custom-morning-brief
npm install

cd /opt/claw/node-services/dynamic-dashboard
npm install

cd /opt/claw/node-services/agent-bridge
npm install
```

## Environment files

Create these files on the server:

- `/opt/claw/node-services/personal-crm/.env`
- `/opt/claw/node-services/wecom-bridge/.env`
- `/opt/claw/node-services/custom-morning-brief/.env`
- `/opt/claw/node-services/dynamic-dashboard/.env`
- `/opt/claw/node-services/agent-bridge/.env`

Use the corresponding `.env.example` files as templates.

## Snowchuang OpenClaw skill

The Snowchuang ordering API skill lives in this repo at:

- `/opt/claw/openclaw-skills/snowchuang/xuechuang-ordering`

Install it into the Snowchuang agent workspace on the server:

```bash
mkdir -p ~/.openclaw/workspace-snowchuang/skills
rsync -a /opt/claw/openclaw-skills/snowchuang/xuechuang-ordering/ \
  ~/.openclaw/workspace-snowchuang/skills/xuechuang-ordering/
```

Configure credentials without committing them to git. Either inject them through OpenClaw config:

```bash
openclaw config set 'skills.entries["xuechuang-ordering"].env' \
  '{"XCDHT_MCP_KEY":"replace_me","XCDHT_MCP_SECRET":"replace_me"}'
```

Or add them to `/opt/claw/node-services/agent-bridge/.env` so the spawned OpenClaw process inherits them:

```bash
XCDHT_MCP_KEY=replace_me
XCDHT_MCP_SECRET='replace_me'
```

Quote `XCDHT_MCP_SECRET` when it contains `#`, `$`, `&`, `!`, `%`, or spaces.

After changing the skill or credentials:

```bash
pm2 restart agent-bridge --update-env
test -f ~/.openclaw/workspace-snowchuang/skills/xuechuang-ordering/SKILL.md
```

If credentials are in `agent-bridge/.env`, verify the helper script with the same environment:

```bash
set -a
. /opt/claw/node-services/agent-bridge/.env
set +a
python3 ~/.openclaw/workspace-snowchuang/skills/xuechuang-ordering/scripts/xcdht_api.py \
  users --page-no 1 --page-size 1
```

Then run one end-to-end Snowchuang agent smoke test:

```bash
openclaw agent --agent snowchuang --message "查一下雪创订货通用户列表第一页，只返回1个用户id和会员等级" --json
```

## PM2 processes

```bash
pm2 start /opt/claw/node-services/personal-crm/index.js --name personal-crm --cwd /opt/claw/node-services/personal-crm
pm2 start /opt/claw/node-services/wecom-bridge/index.js --name wecom-bridge --cwd /opt/claw/node-services/wecom-bridge
pm2 start /opt/claw/node-services/custom-morning-brief/index.js --name custom-morning-brief --cwd /opt/claw/node-services/custom-morning-brief
pm2 start /opt/claw/node-services/dynamic-dashboard/index.js --name dynamic-dashboard --cwd /opt/claw/node-services/dynamic-dashboard
pm2 start /opt/claw/node-services/agent-bridge/index.js --name agent-bridge --cwd /opt/claw/node-services/agent-bridge
pm2 save
```

## Update flow

```bash
cd /opt/claw
git pull

cd /opt/claw/node-services/personal-crm
npm install

cd /opt/claw/node-services/wecom-bridge
npm install

cd /opt/claw/node-services/custom-morning-brief
npm install

cd /opt/claw/node-services/dynamic-dashboard
npm install

cd /opt/claw/node-services/agent-bridge
npm install

pm2 restart personal-crm --update-env
pm2 restart wecom-bridge --update-env
pm2 restart custom-morning-brief --update-env
pm2 restart dynamic-dashboard --update-env
pm2 restart agent-bridge --update-env
```
