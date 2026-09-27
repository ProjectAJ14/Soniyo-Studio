"""In-process pub/sub. Publishing carries only the changed job id: subscribers re-read a fresh
snapshot, so a change to one job (e.g. queue positions moving) reaches every SSE stream."""

import asyncio


class Hub:
    """Create inside the running loop. `publish` may be called from any thread: sync routes
    (cancel, create) run in the threadpool, and asyncio primitives are not thread-safe."""

    def __init__(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._subs: set[asyncio.Queue[str]] = set()
        self.wake = asyncio.Event()  # the worker waits on this for new work

    def publish(self, job_id: str) -> None:
        try:
            on_loop = asyncio.get_running_loop() is self._loop
        except RuntimeError:
            on_loop = False
        if on_loop:
            self._publish(job_id)
        else:
            self._loop.call_soon_threadsafe(self._publish, job_id)

    def _publish(self, job_id: str) -> None:
        self.wake.set()
        for q in self._subs:
            q.put_nowait(job_id)

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue()
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subs.discard(q)
