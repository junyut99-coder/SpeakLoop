import hashlib
import hmac
import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.api.utils import public_user, token_response
from app.core.config import settings
from app.core.dependencies import CurrentUser, SessionDep
from app.core.security import hash_password, verify_password
from app.models import PhoneVerification, User, utc_now
from app.schemas import (
    LoginInput,
    PasswordChangeInput,
    PhoneChangeInput,
    PhoneCodeRequest,
    PhoneCodeResponse,
    RegisterInput,
    TokenResponse,
    UserPublic,
)


router = APIRouter(prefix="/auth", tags=["账号与认证"])


def code_digest(code: str) -> str:
    return hashlib.sha256(f"{settings.secret_key}:{code}".encode("utf-8")).hexdigest()


def normalize_phone(value: str) -> str:
    phone = re.sub(r"[\s()-]", "", value)
    if not re.fullmatch(r"\+?[0-9]{7,20}", phone):
        raise HTTPException(status_code=422, detail="请输入有效的手机号。")
    return phone


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterInput, session: SessionDep) -> TokenResponse:
    email = str(payload.email).strip().lower()
    existing = session.exec(select(User).where(User.email == email)).first()
    if existing:
        raise HTTPException(status_code=409, detail="这个邮箱已经注册，请直接登录。")

    user = User(
        email=email,
        hashed_password=hash_password(payload.password),
        display_name=payload.display_name,
        languages=list(dict.fromkeys(payload.languages)),
    )
    session.add(user)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail="这个邮箱已经注册，请直接登录。") from exc
    session.refresh(user)
    return token_response(user)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginInput, session: SessionDep) -> TokenResponse:
    email = str(payload.email).strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确。")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="该账号当前不可用。")
    return token_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current_user: CurrentUser, session: SessionDep) -> None:
    current_user.token_version += 1
    session.add(current_user)
    session.commit()


@router.get("/me", response_model=UserPublic)
def read_me(current_user: CurrentUser) -> UserPublic:
    return public_user(current_user)


@router.post("/change-password", response_model=TokenResponse)
def change_password(
    payload: PasswordChangeInput, current_user: CurrentUser, session: SessionDep
) -> TokenResponse:
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="当前密码不正确。")
    if hmac.compare_digest(payload.current_password, payload.new_password):
        raise HTTPException(status_code=400, detail="新密码需要与当前密码不同。")
    current_user.hashed_password = hash_password(payload.new_password)
    current_user.token_version += 1
    current_user.updated_at = utc_now()
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return token_response(current_user)


@router.post("/phone/request-code", response_model=PhoneCodeResponse)
def request_phone_code(
    payload: PhoneCodeRequest, current_user: CurrentUser, session: SessionDep
) -> PhoneCodeResponse:
    if not settings.debug:
        raise HTTPException(
            status_code=503,
            detail="短信服务尚未配置，暂时无法发送验证码。",
        )
    phone = normalize_phone(payload.phone)
    taken = session.exec(select(User).where(User.phone == phone, User.id != current_user.id)).first()
    if taken:
        raise HTTPException(status_code=409, detail="这个手机号已绑定其他账号。")

    now = utc_now()
    latest = session.exec(
        select(PhoneVerification)
        .where(PhoneVerification.user_id == current_user.id)
        .order_by(PhoneVerification.created_at.desc())
    ).first()
    if latest and (now - latest.created_at).total_seconds() < 30:
        raise HTTPException(status_code=429, detail="请稍等 30 秒后再获取验证码。")

    code = settings.dev_phone_code or f"{secrets.randbelow(1_000_000):06d}"
    verification = PhoneVerification(
        user_id=current_user.id,
        phone=phone,
        code_hash=code_digest(code),
        created_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    session.add(verification)
    session.commit()
    return PhoneCodeResponse(
        message="本地开发验证码已生成；正式环境需要配置短信服务。",
        expires_in=300,
        debug_code=code,
    )


@router.post("/phone/confirm", response_model=UserPublic)
def confirm_phone(
    payload: PhoneChangeInput, current_user: CurrentUser, session: SessionDep
) -> UserPublic:
    phone = normalize_phone(payload.phone)
    taken = session.exec(select(User).where(User.phone == phone, User.id != current_user.id)).first()
    if taken:
        raise HTTPException(status_code=409, detail="这个手机号已绑定其他账号。")

    verification = session.exec(
        select(PhoneVerification)
        .where(
            PhoneVerification.user_id == current_user.id,
            PhoneVerification.phone == phone,
        )
        .order_by(PhoneVerification.created_at.desc())
    ).first()
    now = utc_now()
    if verification is None or verification.expires_at < now:
        raise HTTPException(status_code=400, detail="验证码已过期，请重新获取。")
    if verification.attempts >= 5:
        raise HTTPException(status_code=429, detail="验证码尝试次数过多，请重新获取。")
    if not hmac.compare_digest(verification.code_hash, code_digest(payload.code)):
        verification.attempts += 1
        session.add(verification)
        session.commit()
        raise HTTPException(status_code=400, detail="验证码不正确。")

    current_user.phone = phone
    current_user.phone_verified = True
    current_user.updated_at = now
    session.add(current_user)
    session.delete(verification)
    session.commit()
    session.refresh(current_user)
    return public_user(current_user)
