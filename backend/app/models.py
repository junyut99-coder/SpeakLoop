from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, JSON, String, UniqueConstraint
from sqlmodel import Field, SQLModel


def utc_now() -> datetime:
    # MySQL DATETIME has no timezone; all saved timestamps are UTC by convention.
    return datetime.now(UTC).replace(tzinfo=None)


class User(SQLModel, table=True):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("phone", name="uq_users_phone"),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, max_length=36)
    email: str = Field(index=True, max_length=320)
    hashed_password: str = Field(sa_column=Column(String(255), nullable=False))
    display_name: str = Field(max_length=24)
    languages: list[str] = Field(
        default_factory=lambda: ["en"], sa_column=Column(JSON, nullable=False)
    )
    gender: str | None = Field(default=None, sa_column=Column(String(16), nullable=True))
    region: str = Field(default="中国大陆", max_length=40)
    phone: str | None = Field(default=None, max_length=24)
    phone_verified: bool = Field(default=False)
    avatar_path: str | None = Field(default=None, max_length=255)
    font_size: int = Field(default=14, ge=12, le=20)
    is_active: bool = Field(default=True)
    token_version: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), nullable=False, onupdate=utc_now),
    )


class PracticeSession(SQLModel, table=True):
    __tablename__ = "practice_sessions"
    __table_args__ = (
        Index("ix_practice_user_activity", "user_id", "last_activity_at"),
        Index("ix_practice_user_status", "user_id", "status"),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, max_length=36)
    user_id: str = Field(foreign_key="users.id", max_length=36, index=True)
    scenario_key: str = Field(max_length=120, index=True)
    scenario_title: str = Field(max_length=120)
    language: str = Field(max_length=8, index=True)
    level: str = Field(max_length=20)
    category: str = Field(default="情景练习", max_length=80)
    status: str = Field(default="in_progress", max_length=20, index=True)
    current_round: int = Field(default=1, ge=1)
    total_rounds: int = Field(default=4, ge=1)
    duration_seconds: int = Field(default=0, ge=0)
    messages: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    feedback: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    started_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    last_activity_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    ended_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )


class FavoriteSnapshot(SQLModel, table=True):
    __tablename__ = "favorite_snapshots"
    __table_args__ = (
        UniqueConstraint("user_id", "scenario_key", name="uq_favorites_user_scenario"),
        Index("ix_favorites_user_language_saved", "user_id", "language", "saved_at"),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, max_length=36)
    user_id: str = Field(foreign_key="users.id", max_length=36, index=True)
    scenario_key: str = Field(max_length=120)
    scenario_title: str = Field(max_length=120)
    language: str = Field(max_length=8)
    level: str = Field(max_length=20)
    category: str = Field(default="情景练习", max_length=80)
    current_round: int = Field(default=1, ge=1)
    total_rounds: int = Field(default=4, ge=1)
    messages: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False)
    )
    saved_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )


class PhoneVerification(SQLModel, table=True):
    __tablename__ = "phone_verifications"
    __table_args__ = (Index("ix_phone_code_user_created", "user_id", "created_at"),)

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, max_length=36)
    user_id: str = Field(foreign_key="users.id", max_length=36, index=True)
    phone: str = Field(max_length=24)
    code_hash: str = Field(max_length=64)
    attempts: int = Field(default=0, ge=0)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))


class SpeechAssessment(SQLModel, table=True):
    __tablename__ = "speech_assessments"
    __table_args__ = (
        Index("ix_speech_user_created", "user_id", "created_at"),
        Index("ix_speech_session_created", "session_id", "created_at"),
    )

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, max_length=36)
    user_id: str = Field(foreign_key="users.id", max_length=36, index=True)
    session_id: str | None = Field(
        default=None, foreign_key="practice_sessions.id", max_length=36, index=True
    )
    language: str = Field(max_length=8, index=True)
    reference_text: str = Field(sa_column=Column(String(1000), nullable=False))
    recognized_text: str = Field(sa_column=Column(String(4000), nullable=False))
    pronunciation_score: float = Field(ge=0, le=5)
    accuracy_score: float | None = Field(default=None, ge=0, le=100)
    fluency_score: float | None = Field(default=None, ge=0, le=100)
    completeness_score: float | None = Field(default=None, ge=0, le=100)
    prosody_score: float | None = Field(default=None, ge=0, le=100)
    words: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    provider: str = Field(default="azure_speech", max_length=32)
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
