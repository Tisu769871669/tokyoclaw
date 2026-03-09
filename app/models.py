from pydantic import BaseModel, Field


class ParsedMail(BaseModel):
    message_id: str
    sender: str
    subject: str
    body_text: str
    received_at: str


class OpenClawDecision(BaseModel):
    category: str = Field(default='other')
    priority: str = Field(default='normal')
    action: str = Field(default='review')
    summary: str = Field(default='')
    reply_draft: str = Field(default='')
    needs_human: bool = Field(default=True)


class MailRecord(BaseModel):
    id: int
    message_id: str
    sender: str
    subject: str
    received_at: str
    status: str
    category: str
    priority: str
    summary: str
    reply_draft: str
    needs_human: bool
