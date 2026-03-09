from datetime import datetime
from typing import Any

from app.clients.mail_client import MailClient
from app.clients.openclaw_client import OpenClawClient
from app.clients.wecom_client import WeComClient
from app.config import Settings
from app.db import db_conn
from app.models import OpenClawDecision, ParsedMail


class MailProcessorService:
    def __init__(self, settings: Settings, mail_client: MailClient, claw_client: OpenClawClient, wecom_client: WeComClient):
        self.settings = settings
        self.mail_client = mail_client
        self.claw_client = claw_client
        self.wecom_client = wecom_client

    async def pull_and_process(self, limit: int = 20) -> dict[str, Any]:
        mails = self.mail_client.fetch_unseen(limit=limit)
        processed = 0
        skipped = 0

        for mail in mails:
            if self._exists(mail.message_id):
                skipped += 1
                continue
            decision = await self.claw_client.analyze_mail(mail)
            mail_id = self._save(mail, decision)
            processed += 1

            if self._should_auto_reply(decision):
                self.mail_client.send_mail(
                    to_addr=mail.sender,
                    subject=f'Re: {mail.subject}',
                    body=decision.reply_draft,
                )
                self._mark_replied(mail_id)
                await self.wecom_client.send_text(
                    self.settings.wecom_report_to,
                    f'邮件已自动回复\nID: {mail_id}\n发件人: {mail.sender}\n主题: {mail.subject}',
                )
            else:
                await self.wecom_client.send_text(
                    self.settings.wecom_report_to,
                    (
                        f'待人工确认邮件\nID: {mail_id}\n发件人: {mail.sender}\n'
                        f'主题: {mail.subject}\n优先级: {decision.priority}\n分类: {decision.category}\n'
                        f'摘要: {decision.summary}\n草稿: {decision.reply_draft[:500]}'
                    ),
                )

        return {'pulled': len(mails), 'processed': processed, 'skipped': skipped}

    def send_manual_reply(self, email_id: int) -> None:
        with db_conn(self.settings.db_path) as conn:
            row = conn.execute('SELECT * FROM emails WHERE id = ?', (email_id,)).fetchone()
            if not row:
                raise ValueError(f'email_id {email_id} not found')
            self.mail_client.send_mail(row['sender'], f"Re: {row['subject']}", row['reply_draft'])
            conn.execute('UPDATE emails SET sent_reply = 1, status = ? WHERE id = ?', ('replied_manual', email_id))
            conn.commit()

    def _exists(self, message_id: str) -> bool:
        with db_conn(self.settings.db_path) as conn:
            row = conn.execute('SELECT id FROM emails WHERE message_id = ?', (message_id,)).fetchone()
            return bool(row)

    def _save(self, mail: ParsedMail, decision: OpenClawDecision) -> int:
        with db_conn(self.settings.db_path) as conn:
            cur = conn.execute(
                '''
                INSERT INTO emails (
                    message_id, sender, subject, received_at, status,
                    category, priority, summary, reply_draft, needs_human, processed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''',
                (
                    mail.message_id,
                    mail.sender,
                    mail.subject,
                    mail.received_at,
                    'processed',
                    decision.category,
                    decision.priority,
                    decision.summary,
                    decision.reply_draft,
                    1 if decision.needs_human else 0,
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            return int(cur.lastrowid)

    def _mark_replied(self, email_id: int) -> None:
        with db_conn(self.settings.db_path) as conn:
            conn.execute('UPDATE emails SET sent_reply = 1, status = ? WHERE id = ?', ('replied_auto', email_id))
            conn.commit()

    def _should_auto_reply(self, decision: OpenClawDecision) -> bool:
        allowed = {x.strip().lower() for x in self.settings.auto_reply_priority.split(',') if x.strip()}
        return (
            self.settings.auto_reply_enabled
            and decision.action == 'auto_reply'
            and decision.priority.lower() in allowed
            and not decision.needs_human
            and bool(decision.reply_draft.strip())
        )
