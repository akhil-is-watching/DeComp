"""Wall-clock metering for jobs.

The runner, not the client, is the source of truth for how long a job ran.
Monotonic clocks are used for durations so NTP adjustments can't skew billing;
epoch timestamps are kept only for display and audit.
"""

from __future__ import annotations

import json
import logging
import time

log = logging.getLogger("job-runner.metering")


class JobMeter:
    def __init__(self) -> None:
        self.started_at: float | None = None
        self.finished_at: float | None = None
        self._t0: float | None = None
        self._t1: float | None = None

    def start(self) -> None:
        self.started_at = time.time()
        self._t0 = time.monotonic()

    def stop(self) -> None:
        if self._t0 is None or self._t1 is not None:
            return
        self._t1 = time.monotonic()
        self.finished_at = time.time()

    @property
    def running(self) -> bool:
        return self._t0 is not None and self._t1 is None

    def elapsed(self) -> float:
        if self._t0 is None:
            return 0.0
        end = self._t1 if self._t1 is not None else time.monotonic()
        return end - self._t0

    def snapshot(self) -> dict:
        return {
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "wall_clock_s": round(self.elapsed(), 3),
        }


def log_job_finished(job_id: str, job_type: str, status: str, meter: JobMeter) -> None:
    # One JSON line per job so billed ticks can be reconciled against measured time.
    log.info(
        json.dumps(
            {"event": "job_finished", "job_id": job_id, "job_type": job_type, "status": status, **meter.snapshot()}
        )
    )
