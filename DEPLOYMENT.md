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
