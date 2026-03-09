from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', case_sensitive=False)

    openclaw_base_url: str
    openclaw_api_key: str
    openclaw_model: str = 'gpt-4o-mini'

    mail_imap_host: str
    mail_imap_port: int = 993
    mail_smtp_host: str
    mail_smtp_port: int = 465
    mail_username: str
    mail_password: str
    mail_use_ssl: bool = True

    wecom_corp_id: str
    wecom_corp_secret: str
    wecom_agent_id: int
    wecom_report_to: str

    auto_reply_enabled: bool = False
    auto_reply_priority: str = 'low,normal'
    report_cron: str = '0 18 * * 1-5'
    tz: str = 'Asia/Shanghai'

    db_path: str = 'app/data/openclaw_mail.db'
    log_level: str = 'INFO'


@lru_cache
def get_settings() -> Settings:
    return Settings()
