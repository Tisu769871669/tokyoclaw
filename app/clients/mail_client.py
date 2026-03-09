import email
import imaplib
import smtplib
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime
from typing import List

from app.models import ParsedMail


class MailClient:
    def __init__(
        self,
        imap_host: str,
        imap_port: int,
        smtp_host: str,
        smtp_port: int,
        username: str,
        password: str,
        use_ssl: bool = True,
    ):
        self.imap_host = imap_host
        self.imap_port = imap_port
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.username = username
        self.password = password
        self.use_ssl = use_ssl

    def fetch_unseen(self, limit: int = 20) -> List[ParsedMail]:
        mails: List[ParsedMail] = []
        imap = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
        imap.login(self.username, self.password)
        try:
            imap.select('INBOX')
            status, data = imap.search(None, 'UNSEEN')
            if status != 'OK':
                return mails

            ids = data[0].split()[-limit:]
            for msg_id in ids:
                _, msg_data = imap.fetch(msg_id, '(RFC822)')
                raw = msg_data[0][1]
                msg = email.message_from_bytes(raw)

                message_id = msg.get('Message-ID', f'local-{msg_id.decode()}')
                subject = str(make_header(decode_header(msg.get('Subject', ''))))
                sender = getaddresses([msg.get('From', '')])[0][1]
                date = msg.get('Date')
                received_at = parsedate_to_datetime(date).isoformat() if date else ''

                body_text = self._extract_text(msg)
                mails.append(
                    ParsedMail(
                        message_id=message_id,
                        sender=sender,
                        subject=subject,
                        body_text=body_text,
                        received_at=received_at,
                    )
                )
        finally:
            imap.logout()

        return mails

    def send_mail(self, to_addr: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg['From'] = self.username
        msg['To'] = to_addr
        msg['Subject'] = subject
        msg.set_content(body)

        smtp = smtplib.SMTP_SSL(self.smtp_host, self.smtp_port) if self.use_ssl else smtplib.SMTP(self.smtp_host, self.smtp_port)
        try:
            smtp.login(self.username, self.password)
            smtp.send_message(msg)
        finally:
            smtp.quit()

    def _extract_text(self, msg: email.message.Message) -> str:
        if msg.is_multipart():
            chunks: list[str] = []
            for part in msg.walk():
                content_type = part.get_content_type()
                disposition = str(part.get('Content-Disposition', ''))
                if content_type == 'text/plain' and 'attachment' not in disposition:
                    payload = part.get_payload(decode=True)
                    charset = part.get_content_charset() or 'utf-8'
                    chunks.append((payload or b'').decode(charset, errors='ignore'))
            return '\n'.join(chunks).strip()

        payload = msg.get_payload(decode=True)
        charset = msg.get_content_charset() or 'utf-8'
        return (payload or b'').decode(charset, errors='ignore').strip()
