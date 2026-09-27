from typing import Annotated

from fastapi import Depends, Request

from ..worker import Runtime


def _rt(request: Request) -> Runtime:
    return request.app.state.rt


Rt = Annotated[Runtime, Depends(_rt)]
