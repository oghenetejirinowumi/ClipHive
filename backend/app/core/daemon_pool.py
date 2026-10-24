"""Background worker threads that never hold up a server shutdown.

A ThreadPoolExecutor joins its threads when Python exits, so one slow job (a 5-minute
transcription request, a long render) kept a stopped or reloading server alive but deaf to
every request. These workers are daemon threads: shutdown abandons the job mid-run, and the
caller's startup recovery (recover_interrupted) resumes it.
"""
from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable

logger = logging.getLogger(__name__)


class DaemonPool:
    def __init__(self, workers: int, name: str) -> None:
        self._workers, self._name = max(1, workers), name
        self._queue: queue.SimpleQueue[tuple[Callable[..., object], tuple]] = queue.SimpleQueue()
        self._started = False
        self._lock = threading.Lock()

    def submit(self, fn: Callable[..., object], *args: object) -> None:
        with self._lock:
            if not self._started:  # started on first use, so importing a module spawns nothing
                for i in range(self._workers):
                    threading.Thread(target=self._work, name=f"{self._name}_{i}", daemon=True).start()
                self._started = True
        self._queue.put((fn, args))

    def _work(self) -> None:
        while True:
            fn, args = self._queue.get()
            try:
                fn(*args)
            except Exception:
                logger.exception("%s job failed", self._name)
