from datetime import datetime, timedelta

import httpx


class WeComClient:
    def __init__(self, corp_id: str, corp_secret: str, agent_id: int):
        self.corp_id = corp_id
        self.corp_secret = corp_secret
        self.agent_id = agent_id
        self._token: str | None = None
        self._token_expire_at: datetime | None = None

    async def _get_token(self) -> str:
        now = datetime.utcnow()
        if self._token and self._token_expire_at and now < self._token_expire_at:
            return self._token

        url = 'https://qyapi.weixin.qq.com/cgi-bin/gettoken'
        params = {'corpid': self.corp_id, 'corpsecret': self.corp_secret}
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        if data.get('errcode') != 0:
            raise RuntimeError(f'wecom gettoken failed: {data}')

        self._token = data['access_token']
        self._token_expire_at = now + timedelta(seconds=int(data.get('expires_in', 7200) - 60))
        return self._token

    async def send_text(self, to_user: str, content: str) -> None:
        token = await self._get_token()
        url = f'https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}'
        payload = {
            'touser': to_user,
            'msgtype': 'text',
            'agentid': self.agent_id,
            'text': {'content': content[:2048]},
            'safe': 0,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        if data.get('errcode') != 0:
            raise RuntimeError(f'wecom send failed: {data}')
