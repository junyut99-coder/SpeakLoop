"""Store Azure pronunciation assessment results."""

from alembic import op
import sqlalchemy as sa


revision = "0002_speech_assessments"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speech_assessments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=True),
        sa.Column("language", sa.String(length=8), nullable=False),
        sa.Column("reference_text", sa.String(length=1000), nullable=False),
        sa.Column("recognized_text", sa.String(length=4000), nullable=False),
        sa.Column("pronunciation_score", sa.Float(), nullable=False),
        sa.Column("accuracy_score", sa.Float(), nullable=True),
        sa.Column("fluency_score", sa.Float(), nullable=True),
        sa.Column("completeness_score", sa.Float(), nullable=True),
        sa.Column("prosody_score", sa.Float(), nullable=True),
        sa.Column("words", sa.JSON(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["practice_sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_speech_assessments_user_id", "speech_assessments", ["user_id"])
    op.create_index("ix_speech_assessments_session_id", "speech_assessments", ["session_id"])
    op.create_index("ix_speech_assessments_language", "speech_assessments", ["language"])
    op.create_index("ix_speech_user_created", "speech_assessments", ["user_id", "created_at"])
    op.create_index("ix_speech_session_created", "speech_assessments", ["session_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_speech_session_created", table_name="speech_assessments")
    op.drop_index("ix_speech_user_created", table_name="speech_assessments")
    op.drop_index("ix_speech_assessments_language", table_name="speech_assessments")
    op.drop_index("ix_speech_assessments_session_id", table_name="speech_assessments")
    op.drop_index("ix_speech_assessments_user_id", table_name="speech_assessments")
    op.drop_table("speech_assessments")
