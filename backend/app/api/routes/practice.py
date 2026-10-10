from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import select

from app.catalog import SCENARIOS
from app.core.dependencies import CurrentUser, SessionDep
from app.models import FavoriteSnapshot, PracticeSession, utc_now
from app.schemas import (
    FavoriteCreate,
    FavoritePublic,
    LanguageCode,
    PracticeSessionCreate,
    PracticeSessionPatch,
    PracticeSessionPublic,
)


router = APIRouter(tags=["练习数据"])
sessions_router = APIRouter(prefix="/practice-sessions")
favorites_router = APIRouter(prefix="/favorites")


def _owned_session(session: SessionDep, session_id: str, user_id: str) -> PracticeSession:
    item = session.get(PracticeSession, session_id)
    if item is None or item.user_id != user_id:
        raise HTTPException(status_code=404, detail="没有找到这条练习记录。")
    return item


@sessions_router.post("", response_model=PracticeSessionPublic, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: PracticeSessionCreate, current_user: CurrentUser, session: SessionDep
) -> PracticeSession:
    values = payload.model_dump(exclude={"messages"})
    values["messages"] = [message.model_dump(exclude_none=True) for message in payload.messages]
    item = PracticeSession(user_id=current_user.id, **values, last_activity_at=utc_now())
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@sessions_router.get("", response_model=list[PracticeSessionPublic])
def list_sessions(
    current_user: CurrentUser,
    session: SessionDep,
    limit: int = Query(default=30, ge=1, le=30),
) -> list[PracticeSession]:
    return list(
        session.exec(
            select(PracticeSession)
            .where(PracticeSession.user_id == current_user.id)
            .order_by(PracticeSession.last_activity_at.desc())
            .limit(limit)
        ).all()
    )


@sessions_router.get("/current", response_model=PracticeSessionPublic | None)
def current_session(current_user: CurrentUser, session: SessionDep) -> PracticeSession | None:
    return session.exec(
        select(PracticeSession)
        .where(
            PracticeSession.user_id == current_user.id,
            PracticeSession.status == "in_progress",
        )
        .order_by(PracticeSession.last_activity_at.desc())
        .limit(1)
    ).first()


@sessions_router.get("/{session_id}", response_model=PracticeSessionPublic)
def read_session(session_id: str, current_user: CurrentUser, session: SessionDep) -> PracticeSession:
    return _owned_session(session, session_id, current_user.id)


@sessions_router.patch("/{session_id}", response_model=PracticeSessionPublic)
def update_session(
    session_id: str,
    payload: PracticeSessionPatch,
    current_user: CurrentUser,
    session: SessionDep,
) -> PracticeSession:
    item = _owned_session(session, session_id, current_user.id)
    changes = payload.model_dump(exclude_unset=True)
    if "messages" in changes and changes["messages"] is not None:
        changes["messages"] = [
            message.model_dump(exclude_none=True) for message in payload.messages or []
        ]
    for field, value in changes.items():
        setattr(item, field, value)
    if item.current_round > item.total_rounds:
        raise HTTPException(status_code=422, detail="当前轮次不能大于总轮数。")
    item.last_activity_at = utc_now()
    if item.status in {"completed", "abandoned"} and item.ended_at is None:
        item.ended_at = item.last_activity_at
    elif item.status == "in_progress":
        item.ended_at = None
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@favorites_router.get("", response_model=list[FavoritePublic])
def list_favorites(
    current_user: CurrentUser,
    session: SessionDep,
    language: LanguageCode | None = None,
) -> list[FavoriteSnapshot]:
    query = select(FavoriteSnapshot).where(FavoriteSnapshot.user_id == current_user.id)
    if language:
        query = query.where(FavoriteSnapshot.language == language)
    query = query.order_by(FavoriteSnapshot.saved_at.desc())
    return list(session.exec(query).all())


@favorites_router.post("", response_model=FavoritePublic)
def save_favorite(
    payload: FavoriteCreate, current_user: CurrentUser, session: SessionDep
) -> FavoriteSnapshot:
    item = session.exec(
        select(FavoriteSnapshot).where(
            FavoriteSnapshot.user_id == current_user.id,
            FavoriteSnapshot.scenario_key == payload.scenario_key,
        )
    ).first()
    values = payload.model_dump(exclude={"messages"})
    values["messages"] = [message.model_dump(exclude_none=True) for message in payload.messages]
    if item is None:
        item = FavoriteSnapshot(user_id=current_user.id, **values)
    else:
        for field, value in values.items():
            setattr(item, field, value)
        item.saved_at = utc_now()
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@favorites_router.delete("/{favorite_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_favorite(favorite_id: str, current_user: CurrentUser, session: SessionDep) -> None:
    item = session.get(FavoriteSnapshot, favorite_id)
    if item is None or item.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="没有找到这条收藏。")
    session.delete(item)
    session.commit()


@router.get("/dashboard/summary")
def dashboard_summary(current_user: CurrentUser, session: SessionDep) -> dict[str, object]:
    recent = list(
        session.exec(
            select(PracticeSession)
            .where(PracticeSession.user_id == current_user.id)
            .order_by(PracticeSession.last_activity_at.desc())
            .limit(30)
        ).all()
    )
    return {
        "recent_count": len(recent),
        "completed_count": sum(item.status == "completed" for item in recent),
        "minutes": sum(item.duration_seconds for item in recent) // 60,
        "languages": sorted({item.language for item in recent}),
        "scenarios_available": len(SCENARIOS),
    }


router.include_router(sessions_router)
router.include_router(favorites_router)
