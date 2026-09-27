"""The one error shape: {"error": {code, message, retryable}}. See docs/api-contract.md."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_STATUS = {
    "unauthorized": 401,
    "not_found": 404,
    "validation_failed": 422,
    "conflict": 409,
    "method_not_allowed": 405,
    "range_not_satisfiable": 416,
    "engine_unavailable": 503,
    "internal": 500,
}
_RETRYABLE = {"engine_unavailable", "internal"}


class ApiError(Exception):
    def __init__(self, code: str, message: str, retryable: bool | None = None):
        assert code in _STATUS, code
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = code in _RETRYABLE if retryable is None else retryable

    @property
    def status(self) -> int:
        return _STATUS[self.code]

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, "retryable": self.retryable}}


def _json(err: ApiError) -> JSONResponse:
    return JSONResponse(err.body(), status_code=err.status)


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, exc: ApiError) -> JSONResponse:
        return _json(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return _json(ApiError("validation_failed", f"{where}: {first.get('msg', 'invalid')}"))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {401: "unauthorized", 404: "not_found", 405: "method_not_allowed",
                 409: "conflict", 416: "range_not_satisfiable"}  # fmt: skip
        code = codes.get(exc.status_code)
        if code is None:  # any other status becomes a documented code/status pair
            code = "validation_failed" if exc.status_code < 500 else "internal"
        return _json(ApiError(code, str(exc.detail)))



def unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Called from main's middleware, inside CORS, so browsers can read the 500 body.
    (An `Exception` handler would run in Starlette's outermost layer, outside CORS.)"""
    logging.getLogger(__name__).error(
        "unhandled %s %s", request.method, request.url.path, exc_info=exc
    )
    return _json(ApiError("internal", "Unexpected gateway error. Check the gateway log."))
