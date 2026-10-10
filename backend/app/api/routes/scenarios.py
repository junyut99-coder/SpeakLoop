from typing import Literal

from fastapi import APIRouter, Query

from app.catalog import LANGUAGE_NAMES, SCENARIOS
from app.schemas import LanguageCode, LevelCode


router = APIRouter(prefix="/scenarios", tags=["练习场景"])


@router.get("")
def list_scenarios(
    language: LanguageCode = "en",
    level: LevelCode | None = None,
) -> dict[str, object]:
    items = [scenario for scenario in SCENARIOS if level is None or scenario["level"] == level]
    return {
        "language": language,
        "language_name": LANGUAGE_NAMES[language],
        "items": items,
        "count": len(items),
    }
