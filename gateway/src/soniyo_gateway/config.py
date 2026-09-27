"""Settings from environment variables. Read once at startup; nothing else reads os.environ."""

import os
from dataclasses import dataclass, field
from pathlib import Path


def _list(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    owner_token: str
    data_dir: Path
    host: str = "127.0.0.1"
    port: int = 8787
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    engine: str = "acestep"  # "acestep" | "fake"
    engine_url: str = "http://127.0.0.1:8001"
    engine_key: str = ""
    engine_poll_seconds: float = 3.0
    lm_cap_seconds: int = 480
    dit_model: str = "acestep-v15-turbo"
    lm_model: str = "acestep-5Hz-lm-0.6B"
    web_dist: Path | None = None
    low_disk_bytes: int = 10 * 1024**3
    health_fail_threshold: int = 3
    health_poll_seconds: float = 20.0
    health_busy_grace_seconds: float = 900.0
    fake_seconds: float = 5.0
    engine_restart_cmd: str = ""
    log_dir: Path = field(default_factory=lambda: Path.home() / "Library" / "Logs" / "AceStudio")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "soniyo.sqlite3"

    @property
    def audio_dir(self) -> Path:
        return self.data_dir / "audio"

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        token = env.get("SONIYO_OWNER_TOKEN", "")
        if len(token) < 32:
            raise SystemExit("SONIYO_OWNER_TOKEN must be set to at least 32 characters")
        web_dist = env.get("SONIYO_WEB_DIST")
        host = env.get("SONIYO_HOST", "127.0.0.1")
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise SystemExit("SONIYO_HOST must be loopback; expose the gateway via Tailscale Serve")
        return cls(
            owner_token=token,
            data_dir=Path(env.get("SONIYO_DATA_DIR", str(Path.home() / "AceStudio"))).expanduser(),
            host=host,
            port=int(env.get("SONIYO_PORT", "8787")),
            cors_origins=_list(env.get("SONIYO_CORS_ORIGINS", "http://localhost:5173")),
            engine=env.get("SONIYO_ENGINE", "acestep"),
            engine_url=env.get("SONIYO_ENGINE_URL", "http://127.0.0.1:8001"),
            engine_key=env.get("ACESTEP_API_KEY", ""),
            engine_poll_seconds=float(env.get("SONIYO_ENGINE_POLL_SECONDS", "3")),
            lm_cap_seconds=int(env.get("SONIYO_LM_CAP_SECONDS", "480")),
            dit_model=env.get("SONIYO_DIT_MODEL", "acestep-v15-turbo"),
            lm_model=env.get("SONIYO_LM_MODEL", "acestep-5Hz-lm-0.6B"),
            web_dist=Path(web_dist) if web_dist else None,
            fake_seconds=float(env.get("SONIYO_FAKE_SECONDS", "5")),
            engine_restart_cmd=env.get("SONIYO_ENGINE_RESTART_CMD", ""),
            health_busy_grace_seconds=float(env.get("SONIYO_HEALTH_BUSY_GRACE_SECONDS", "900")),
            log_dir=Path(
                env.get("SONIYO_LOG_DIR", str(Path.home() / "Library" / "Logs" / "AceStudio"))
            ).expanduser(),
        )
