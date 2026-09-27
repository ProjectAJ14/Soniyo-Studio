from fastapi import APIRouter, Depends, Response

from .. import library
from ..auth import require_token
from ..schemas import Preset, PresetIn, PresetList
from . import Rt

router = APIRouter(prefix="/presets", dependencies=[Depends(require_token)])


@router.get("")
def list_presets(rt: Rt) -> PresetList:
    return PresetList(items=rt.repo.list_presets())


@router.post("", status_code=201)
def create_preset(body: PresetIn, rt: Rt) -> Preset:
    return library.create_preset(rt.repo, body)


@router.get("/{preset_id}")
def get_preset(preset_id: str, rt: Rt) -> Preset:
    return library.get_preset(rt.repo, preset_id)


@router.put("/{preset_id}")
def update_preset(preset_id: str, body: PresetIn, rt: Rt) -> Preset:
    return library.update_preset(rt.repo, preset_id, body)


@router.delete("/{preset_id}", status_code=204)
def delete_preset(preset_id: str, rt: Rt) -> Response:
    library.delete_preset(rt.repo, preset_id)
    return Response(status_code=204)
