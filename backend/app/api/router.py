from fastapi import APIRouter

from app.api.routes import auth, practice, scenarios, speech, users


api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(scenarios.router)
api_router.include_router(practice.router)
api_router.include_router(speech.router)
