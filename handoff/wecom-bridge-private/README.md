# WeCom Bridge Private Bundle

This directory is a private deployment bundle for the Enterprise WeChat bridge only.

Included:
- wecom-bridge runtime code
- real .env used by the current deployment
- nginx callback reverse-proxy config

Excluded on purpose:
- personal-crm
- custom-morning-brief
- dynamic-dashboard

Recommended target path on server:
- /opt/wecom-bridge

Deploy steps:
1. copy this directory to the target server
2. run npm install
3. place .env in the service root
4. apply nginx/tokyoclaw.wecom.conf as the callback proxy config
5. start with PM2:
   - pm2 start /opt/wecom-bridge/index.js --name wecom-bridge --cwd /opt/wecom-bridge
   - pm2 save
