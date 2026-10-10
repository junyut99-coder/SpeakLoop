"""Create the first SpeakLoop user and practice tables."""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=24), nullable=False),
        sa.Column("languages", sa.JSON(), nullable=False),
        sa.Column("gender", sa.String(length=16), nullable=True),
        sa.Column("region", sa.String(length=40), nullable=False),
        sa.Column("phone", sa.String(length=24), nullable=True),
        sa.Column("phone_verified", sa.Boolean(), nullable=False),
        sa.Column("avatar_path", sa.String(length=255), nullable=True),
        sa.Column("font_size", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("token_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
        sa.UniqueConstraint("phone", name="uq_users_phone"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=False)

    op.create_table(
        "practice_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("scenario_key", sa.String(length=120), nullable=False),
        sa.Column("scenario_title", sa.String(length=120), nullable=False),
        sa.Column("language", sa.String(length=8), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("current_round", sa.Integer(), nullable=False),
        sa.Column("total_rounds", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("feedback", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_practice_sessions_user_id", "practice_sessions", ["user_id"])
    op.create_index("ix_practice_sessions_scenario_key", "practice_sessions", ["scenario_key"])
    op.create_index("ix_practice_sessions_language", "practice_sessions", ["language"])
    op.create_index("ix_practice_sessions_status", "practice_sessions", ["status"])
    op.create_index(
        "ix_practice_user_activity", "practice_sessions", ["user_id", "last_activity_at"]
    )
    op.create_index("ix_practice_user_status", "practice_sessions", ["user_id", "status"])

    op.create_table(
        "favorite_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("scenario_key", sa.String(length=120), nullable=False),
        sa.Column("scenario_title", sa.String(length=120), nullable=False),
        sa.Column("language", sa.String(length=8), nullable=False),
        sa.Column("level", sa.String(length=20), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False),
        sa.Column("current_round", sa.Integer(), nullable=False),
        sa.Column("total_rounds", sa.Integer(), nullable=False),
        sa.Column("messages", sa.JSON(), nullable=False),
        sa.Column("saved_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "scenario_key", name="uq_favorites_user_scenario"),
    )
    op.create_index("ix_favorite_snapshots_user_id", "favorite_snapshots", ["user_id"])
    op.create_index(
        "ix_favorites_user_language_saved",
        "favorite_snapshots",
        ["user_id", "language", "saved_at"],
    )

    op.create_table(
        "phone_verifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("phone", sa.String(length=24), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_phone_verifications_user_id", "phone_verifications", ["user_id"])
    op.create_index(
        "ix_phone_code_user_created", "phone_verifications", ["user_id", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_phone_code_user_created", table_name="phone_verifications")
    op.drop_index("ix_phone_verifications_user_id", table_name="phone_verifications")
    op.drop_table("phone_verifications")
    op.drop_index("ix_favorites_user_language_saved", table_name="favorite_snapshots")
    op.drop_index("ix_favorite_snapshots_user_id", table_name="favorite_snapshots")
    op.drop_table("favorite_snapshots")
    op.drop_index("ix_practice_user_status", table_name="practice_sessions")
    op.drop_index("ix_practice_user_activity", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_status", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_language", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_scenario_key", table_name="practice_sessions")
    op.drop_index("ix_practice_sessions_user_id", table_name="practice_sessions")
    op.drop_table("practice_sessions")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
