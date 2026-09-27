from fastapi import APIRouter, Depends

from ..auth import require_token
from ..compiler import compile_spec
from ..errors import ApiError
from ..schemas import BuilderSpec, CompileResult
from . import Rt

router = APIRouter(dependencies=[Depends(require_token)])


@router.post("/compile")
def compile_(spec: BuilderSpec, rt: Rt) -> CompileResult:
    try:
        return compile_spec(spec, lm_cap_seconds=rt.settings.lm_cap_seconds)
    except ValueError as e:
        raise ApiError("validation_failed", str(e)) from e
