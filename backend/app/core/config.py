from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "SpeakLoop API"
    api_v1_prefix: str = "/api/v1"
    debug: bool = True
    secret_key: str = "development-only-secret-replace-before-deploy"
    access_token_minutes: int = Field(default=90, ge=5, le=1440)
    database_url: str = (
        "mysql+pymysql://speakloop:speakloop_local@127.0.0.1:3307/"
        "speakloop?charset=utf8mb4"
    )
    media_dir: str = "media"
    max_avatar_bytes: int = Field(default=2 * 1024 * 1024, ge=1024, le=10 * 1024 * 1024)
    dev_phone_code: str | None = None
    azure_speech_key: str | None = None
    azure_speech_region: str | None = None
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:5500", "http://127.0.0.1:5500"]
    )

    @model_validator(mode="after")
    def validate_production_secret(self) -> "Settings":
        if not self.debug and self.secret_key in {
            "development-only-secret-replace-before-deploy",
            "replace-this-with-a-long-random-secret-before-deployment",
        }:
            raise ValueError("Set a unique SECRET_KEY before running with DEBUG=false")
        return self

    @property
    def media_path(self) -> Path:
        path = Path(self.media_dir)
        return path if path.is_absolute() else BACKEND_DIR / path


settings = Settings()
