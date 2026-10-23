import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth
from app.config import settings
from app.db import init_db


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.jwt_secret == "change-me":
        logging.getLogger("uvicorn.error").warning(
            "JWT_SECRET is the default 'change-me'. Anyone can forge sessions; set a real one in backend/.env."
        )
    init_db()
    yield


app = FastAPI(title="ClipHive API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Each teammate registers their router here: app.include_router(streams.router), etc.
app.include_router(auth.router)


@app.get("/health", tags=["meta"])
def health() -> dict[str, str]:
    return {"status": "ok"}
