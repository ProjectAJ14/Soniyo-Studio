---
paths:
  - "gateway/**/*.py"
---
# Python gateway rules

- Python 3.12, type hints everywhere, `ruff` clean.
- Routes are thin: validate with pydantic from `schemas.py`, call a service
  function, return a schema. SQL lives in `repo.py` only.
- Raise `ApiError` (errors.py) for expected failures; never return ad-hoc dicts.
- The engine is reached only through the `Engine` protocol in `engine/`; tests use
  `FakeEngine`, never the network.
- Bind 127.0.0.1 only. Never log the owner token or engine key.
- Blocking work (ffmpeg, file copy) runs via `asyncio.to_thread` or subprocess.
