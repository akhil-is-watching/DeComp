"""GPU job-runner sidecar.

Runs jobs from the fixed menu in `jobs/` as killable subprocesses and meters their real
wall-clock time. Only the provider talks to this service; it binds to localhost.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import jobs
from metering import JobMeter, log_job_finished

HERE = Path(__file__).resolve().parent
TERMINAL = {"succeeded", "failed", "killed", "timeout"}

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("job-runner")

app = FastAPI(title="decomp job-runner")


@dataclass
class JobRecord:
    job_id: str
    job_type: str
    params: dict[str, Any]
    max_runtime_s: float
    status: str = "queued"
    meter: JobMeter = field(default_factory=JobMeter)
    result: Any = None
    error: str | None = None
    proc: asyncio.subprocess.Process | None = None

    def view(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "job_type": self.job_type,
            "params": self.params,
            "status": self.status,
            "max_runtime_s": self.max_runtime_s,
            **self.meter.snapshot(),
            "result": self.result,
            "error": self.error,
        }


RECORDS: dict[str, JobRecord] = {}


class RunRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=128)
    job_type: str
    params: dict[str, Any] = Field(default_factory=dict)
    max_runtime_s: float = Field(default=60, gt=0, le=3600)


def _kill(rec: JobRecord) -> None:
    if rec.proc is None or rec.proc.returncode is not None:
        return
    try:
        os.killpg(rec.proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


async def _execute(rec: JobRecord) -> None:
    spec = jobs.MENU[rec.job_type]
    rec.proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        spec.module,
        cwd=HERE,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # own process group, so killpg takes children too
    )
    rec.meter.start()
    rec.status = "running"
    try:
        stdout, stderr = await asyncio.wait_for(
            rec.proc.communicate(json.dumps(rec.params).encode()), timeout=rec.max_runtime_s
        )
    except asyncio.TimeoutError:
        _kill(rec)
        await rec.proc.wait()
        rec.meter.stop()
        rec.status = "timeout"
        rec.error = f"exceeded max_runtime_s={rec.max_runtime_s}"
        log_job_finished(rec.job_id, rec.job_type, rec.status, rec.meter)
        return

    rec.meter.stop()
    if rec.status == "killed":
        pass
    elif rec.proc.returncode != 0:
        rec.status = "failed"
        rec.error = stderr.decode(errors="replace").strip()[-2000:] or f"exit code {rec.proc.returncode}"
    else:
        try:
            rec.result = json.loads(stdout.decode().strip().splitlines()[-1])
            rec.status = "succeeded"
        except (IndexError, json.JSONDecodeError) as exc:
            rec.status = "failed"
            rec.error = f"job produced no JSON result: {exc}"
    log_job_finished(rec.job_id, rec.job_type, rec.status, rec.meter)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "job_types": {name: spec.description for name, spec in jobs.MENU.items()}}


@app.post("/jobs", status_code=202)
async def run_job(req: RunRequest) -> dict[str, Any]:
    spec = jobs.MENU.get(req.job_type)
    if spec is None:
        raise HTTPException(422, f"unknown job_type {req.job_type!r}; menu: {sorted(jobs.MENU)}")
    if req.job_id in RECORDS:
        raise HTTPException(409, f"job {req.job_id} already exists")
    try:
        params = spec.validate(req.params)
    except (ValueError, TypeError) as exc:
        raise HTTPException(422, str(exc)) from exc

    rec = JobRecord(job_id=req.job_id, job_type=req.job_type, params=params, max_runtime_s=req.max_runtime_s)
    RECORDS[rec.job_id] = rec
    asyncio.create_task(_execute(rec))
    return rec.view()


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    rec = RECORDS.get(job_id)
    if rec is None:
        raise HTTPException(404, "job not found")
    return rec.view()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, Any]:
    rec = RECORDS.get(job_id)
    if rec is None:
        raise HTTPException(404, "job not found")
    if rec.status not in TERMINAL:
        rec.status = "killed"
        rec.error = "cancelled by provider"
        _kill(rec)
    return rec.view()
