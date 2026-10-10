from app.core.config import settings
from app.core.security import create_access_token
from app.models import User
from app.schemas import TokenResponse, UserPublic


def public_user(user: User) -> UserPublic:
    return UserPublic(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        languages=user.languages,
        gender=user.gender,
        region=user.region,
        phone=user.phone,
        phone_verified=user.phone_verified,
        avatar_url=user.avatar_path,
        font_size=user.font_size,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def token_response(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        expires_in=settings.access_token_minutes * 60,
        user=public_user(user),
    )
