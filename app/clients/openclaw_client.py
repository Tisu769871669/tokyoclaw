import json
from typing import Any

import httpx

from app.models import OpenClawDecision, ParsedMail


class OpenClawClient:
    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model

    async def analyze_mail(self, mail: ParsedMail) -> OpenClawDecision:
        prompt = (
            '你是企业邮件自动处理助手。请只输出 JSON，不要输出其他文本。'
            'JSON schema: '
            '{"category":"sales|support|finance|hr|other",'
            '"priority":"low|normal|high|urgent",'
            '"action":"auto_reply|review|escalate",'
            '"summary":"<=120字中文摘要",'
            '"reply_draft":"中文回复草稿",'
            '"needs_human":true|false}'
        )
        content = (
            f'发件人: {mail.sender}\n'
            f'主题: {mail.subject}\n'
            f'收件时间: {mail.received_at}\n'
            f'正文:\n{mail.body_text[:5000]}'
        )

        payload: dict[str, Any] = {
            'model': self.model,
            'temperature': 0.2,
            'response_format': {'type': 'json_object'},
            'messages': [
                {'role': 'system', 'content': prompt},
                {'role': 'user', 'content': content},
            ],
        }

        headers = {'Authorization': f'Bearer {self.api_key}'}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f'{self.base_url}/v1/chat/completions', json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        raw = data['choices'][0]['message']['content']
        parsed = json.loads(raw)
        return OpenClawDecision.model_validate(parsed)
