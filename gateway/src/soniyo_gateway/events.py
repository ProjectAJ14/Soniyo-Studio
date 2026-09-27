"""In-process pub/sub. Publishing carries only the changed job id: subscribers re-read a fresh
snapshot, so a change to one job (e.g. queue positions moving) reaches every SSE stream."""

import asyncio


class Hub:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[str]] = set()
        self.wake = asyncio.Event()  # the worker waits on this for new work

    def publish(self, job_id: str) -> None:
        self.wake.set()
        for q in self._subs:
            q.put_nowait(job_id)

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue()
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subs.discard(q)
