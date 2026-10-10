from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings


PROJECT_ROOT = Path(__file__).resolve().parents[2]

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="声桥 SpeakLoop API：账号、个人资料、练习记录、收藏与 Azure Speech 发音评分。",
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

app.include_router(api_router, prefix=settings.api_v1_prefix)

settings.media_path.mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=PROJECT_ROOT / "assets"), name="assets")
app.mount("/media", StaticFiles(directory=settings.media_path), name="media")


@app.get(f"{settings.api_v1_prefix}/health", tags=["运行状态"])
def health() -> dict[str, str]:
    return {"status": "ok", "service": "speakloop-api"}


@app.get("/", include_in_schema=False)
def registration_page() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "index.html")


@app.get("/index.html", include_in_schema=False)
def registration_page_alias() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "index.html")


@app.get("/practice.html", include_in_schema=False)
def practice_page() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "practice.html")
