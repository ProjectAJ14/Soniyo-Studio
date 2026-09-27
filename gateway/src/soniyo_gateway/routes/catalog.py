from fastapi import APIRouter, Depends

from ..auth import require_token
from ..catalog import build_catalog
from ..schemas import Catalog
from . import Rt

router = APIRouter(dependencies=[Depends(require_token)])


@router.get("/catalog")
def catalog(rt: Rt) -> Catalog:
    return build_catalog(lm_cap_seconds=rt.settings.lm_cap_seconds)
