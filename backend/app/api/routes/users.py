from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from sqlalchemy import select

from app.api.utils import public_user
from app.core.config import settings
from app.core.dependencies import CurrentUser, SessionDep
from app.models import User
from app.schemas import PreferencesPatch, ProfilePatch, UserPublic


router = APIRouter(prefix="/users", tags=["个人资料"])


@router.get("/me", response_model=UserPublic)
def read_profile(current_user: CurrentUser) -> UserPublic:
    return public_user(current_user)


@router.patch("/me", response_model=UserPublic)
def update_profile(
    payload: ProfilePatch, current_user: CurrentUser, session: SessionDep
) -> UserPublic:
    values = payload.model_dump(exclude_unset=True)
    for field, value in values.items():
        setattr(current_user, field, value)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return public_user(current_user)


@router.patch("/me/preferences", response_model=UserPublic)
def update_preferences(
    payload: PreferencesPatch, current_user: CurrentUser, session: SessionDep
) -> UserPublic:
    current_user.font_size = payload.font_size
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return public_user(current_user)


def _valid_image_signature(content_type: str, data: bytes) -> bool:
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


@router.post("/me/avatar", response_model=UserPublic)
async def upload_avatar(
    current_user: CurrentUser,
    session: SessionDep,
    file: UploadFile = File(...),
) -> UserPublic:
    extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    content_type = (file.content_type or "").lower()
    if content_type not in extensions:
        raise HTTPException(status_code=415, detail="头像仅支持 JPG、PNG 或 WebP 图片。")
    data = await file.read(settings.max_avatar_bytes + 1)
    if not data:
        raise HTTPException(status_code=400, detail="上传的头像文件为空。")
    if len(data) > settings.max_avatar_bytes:
        raise HTTPException(status_code=413, detail="头像文件不能超过 2 MB。")
    if not _valid_image_signature(content_type, data):
        raise HTTPException(status_code=415, detail="图片文件内容无效。")

    avatar_dir = settings.media_path / "avatars"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{extensions[content_type]}"
    (avatar_dir / filename).write_bytes(data)
    current_user.avatar_path = f"/media/avatars/{filename}"
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return public_user(current_user)
