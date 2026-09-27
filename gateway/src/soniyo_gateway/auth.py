"""Owner-token auth. Header everywhere; `?token=` only where the browser cannot set headers."""

import hmac

from fastapi import Request

from .errors import ApiError


def _bearer(request: Request) -> str:
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    return value.strip() if scheme.lower() == "bearer" else ""


def token_ok(request: Request, *, allow_query: bool = False) -> bool:
    given = _bearer(request)
    if not given and allow_query:
        given = request.query_params.get("token", "")
    expected = request.app.state.rt.settings.owner_token
    return bool(given) and hmac.compare_digest(given.encode(), expected.encode())


def require_token(request: Request) -> None:
    if not token_ok(request):
        raise ApiError("unauthorized", "Missing or wrong owner token.")


def require_token_or_query(request: Request) -> None:
    """For <audio src> and EventSource, which cannot send an Authorization header."""
    if not token_ok(request, allow_query=True):
        raise ApiError("unauthorized", "Missing or wrong owner token.")
