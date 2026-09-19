from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres in dev/prod; tests override with SQLite via the DATABASE_URL env var.
    DATABASE_URL: str = "postgresql+psycopg://gurukrupa:gurukrupa@localhost:5432/gurukrupa"
    SECRET_KEY: str = "change-me-in-.env"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MIN: int = 60 * 12  # one clinic day
    UPLOAD_DIR: str = "./uploads"
    TESSERACT_CMD: str | None = None
    READING_IMAGE_RETENTION_DAYS: int = 7  # printout photos of done/failed readings are purged after this
    CLINIC_TZ: str = "Asia/Kolkata"  # clinic day boundary, independent of server TZ
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    USE_X_ACCEL: bool = False  # prod: empty body + X-Accel-Redirect so Nginx streams /uploads (deploy/README.md)


settings = Settings()
