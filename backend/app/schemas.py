from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


LanguageCode = Literal["en", "ja", "zh"]
LevelCode = Literal["beginner", "intermediate", "advanced"]
GenderCode = Literal["female", "male", "other"]
SessionStatus = Literal["in_progress", "completed", "abandoned"]
MessageRole = Literal["assistant", "user"]


class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=1, max_length=24)
    languages: list[LanguageCode] = Field(min_length=1, max_length=3)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("称呼不能为空。")
        return value

    @field_validator("languages")
    @classmethod
    def unique_languages(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("练习语言不能重复。")
        return value


class LoginInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    display_name: str
    languages: list[LanguageCode]
    gender: GenderCode | None
    region: str
    phone: str | None
    phone_verified: bool
    avatar_url: str | None
    font_size: int
    created_at: datetime
    updated_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserPublic


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=24)
    gender: GenderCode | None = None
    region: str | None = Field(default=None, min_length=1, max_length=40)
    languages: list[LanguageCode] | None = Field(default=None, min_length=1, max_length=3)

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("昵称不能为空。")
        return value


class PreferencesPatch(BaseModel):
    font_size: int = Field(ge=12, le=20)


class PasswordChangeInput(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class PhoneCodeRequest(BaseModel):
    phone: str = Field(min_length=7, max_length=24)


class PhoneCodeResponse(BaseModel):
    message: str
    expires_in: int
    debug_code: str | None = None


class PhoneChangeInput(BaseModel):
    phone: str = Field(min_length=7, max_length=24)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class ConversationMessage(BaseModel):
    role: MessageRole
    text: str = Field(min_length=1, max_length=4000)
    translation: str | None = Field(default=None, max_length=4000)


class PracticeSessionCreate(BaseModel):
    scenario_key: str = Field(min_length=1, max_length=120)
    scenario_title: str = Field(min_length=1, max_length=120)
    language: LanguageCode
    level: LevelCode
    category: str = Field(default="情景练习", max_length=80)
    current_round: int = Field(default=1, ge=1, le=100)
    total_rounds: int = Field(default=4, ge=1, le=100)
    duration_seconds: int = Field(default=0, ge=0, le=86400)
    messages: list[ConversationMessage] = Field(default_factory=list, max_length=200)


class PracticeSessionPatch(BaseModel):
    scenario_key: str | None = Field(default=None, min_length=1, max_length=120)
    scenario_title: str | None = Field(default=None, min_length=1, max_length=120)
    language: LanguageCode | None = None
    level: LevelCode | None = None
    category: str | None = Field(default=None, max_length=80)
    status: SessionStatus | None = None
    current_round: int | None = Field(default=None, ge=1, le=100)
    total_rounds: int | None = Field(default=None, ge=1, le=100)
    duration_seconds: int | None = Field(default=None, ge=0, le=86400)
    messages: list[ConversationMessage] | None = Field(default=None, max_length=200)
    feedback: dict[str, Any] | None = None


class PracticeSessionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scenario_key: str
    scenario_title: str
    language: LanguageCode
    level: LevelCode
    category: str
    status: SessionStatus
    current_round: int
    total_rounds: int
    duration_seconds: int
    messages: list[dict[str, Any]]
    feedback: dict[str, Any] | None
    started_at: datetime
    last_activity_at: datetime
    ended_at: datetime | None


class FavoriteCreate(BaseModel):
    scenario_key: str = Field(min_length=1, max_length=120)
    scenario_title: str = Field(min_length=1, max_length=120)
    language: LanguageCode
    level: LevelCode
    category: str = Field(default="情景练习", max_length=80)
    current_round: int = Field(default=1, ge=1, le=100)
    total_rounds: int = Field(default=4, ge=1, le=100)
    messages: list[ConversationMessage] = Field(default_factory=list, max_length=200)


class FavoritePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    scenario_key: str
    scenario_title: str
    language: LanguageCode
    level: LevelCode
    category: str
    current_round: int
    total_rounds: int
    messages: list[dict[str, Any]]
    saved_at: datetime


class SpeechAssessmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    session_id: str | None
    language: LanguageCode
    reference_text: str
    recognized_text: str
    pronunciation_score: float
    accuracy_score: float | None
    fluency_score: float | None
    completeness_score: float | None
    prosody_score: float | None
    words: list[dict[str, Any]]
    provider: str
    created_at: datetime
