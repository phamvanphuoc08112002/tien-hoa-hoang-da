"""FastAPI app and local dashboard."""

from __future__ import annotations

import json
import threading
import uuid
import zipfile
from io import BytesIO
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from pydantic import Field

from creature_factory.adapters import probe_environment
from creature_factory.adapters.metadata_store import SqliteMetadata, job_view
from creature_factory.config import PROJECT_ROOT, Settings, load_settings
from creature_factory.pipeline import now
from creature_factory.pipeline.engine import STAGE_COUNT, execute_pipeline
from creature_factory.specs import CreatureSpec


class GenerateBody(CreatureSpec):
    sync: bool = True
    batch: int = Field(default=1, ge=1, le=4)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    store = SqliteMetadata(settings.database_path)
    app = FastAPI(title="Creature Factory", version="0.1.0")
    app.state.settings = settings
    app.state.store = store
    web = PROJECT_ROOT / "web"

    @app.get("/")
    def dashboard():
        page = web / "index.html"
        if not page.is_file():
            raise HTTPException(500, "dashboard file is missing")
        return HTMLResponse(page.read_text(encoding="utf-8"))

    @app.get("/assets/{name}")
    def assets(name: str):
        if name not in {"app.js", "styles.css"}:
            raise HTTPException(404)
        return FileResponse(web / name)

    @app.get("/api/health")
    def health():
        return {"ok": True, "generator": settings.generator, "orchestrator": "builtin"}

    @app.get("/api/system")
    def system():
        return {"tools": probe_environment(settings), "stages": STAGE_COUNT, "generator": settings.generator}

    @app.get("/api/profiles")
    def profiles():
        return settings.profiles

    @app.get("/api/archetypes")
    def archetypes():
        return settings.archetypes

    @app.get("/api/jobs")
    def jobs():
        return [job_view(row) for row in store.list_jobs()]

    @app.get("/api/jobs/{job_id}")
    def job(job_id: str):
        row = store.get_job(job_id)
        if row is None:
            raise HTTPException(404, "job not found")
        return job_view(row)

    @app.get("/api/library")
    def library():
        return store.list_creatures()

    @app.get("/api/creatures/{creature_id}")
    def creature(creature_id: str):
        row = store.get_creature(creature_id)
        folder = _creature_dir(settings, creature_id)
        metadata_path = folder / "metadata.json"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.is_file() else None
        if row is None and metadata is None:
            raise HTTPException(404, "creature not found")
        return {"record": row, "metadata": metadata}

    @app.get("/api/creatures/{creature_id}/download")
    def download(creature_id: str):
        folder = _creature_dir(settings, creature_id)
        if not folder.is_dir():
            raise HTTPException(404, "creature folder not found")
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in folder.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(folder).as_posix())
        return Response(
            content=buffer.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{creature_id}.zip"'},
        )

    @app.get("/files/{creature_id}/{filepath:path}")
    def files(creature_id: str, filepath: str):
        folder = _creature_dir(settings, creature_id).resolve()
        target = (folder / filepath).resolve()
        if not target.is_relative_to(folder) or not target.is_file():
            raise HTTPException(404, "file not found")
        return FileResponse(target)

    @app.post("/api/generate")
    def generate(body: GenerateBody):
        try:
            settings.profile(body.quality_profile or settings.quality_profile)
        except KeyError as exc:
            raise HTTPException(400, str(exc)) from exc
        payload = body.model_dump()
        sync = payload.pop("sync")
        batch = payload.pop("batch")
        batch_id = uuid.uuid4().hex[:10]
        created = []
        for index in range(batch):
            spec_data = dict(payload)
            if batch > 1:
                base = spec_data.get("creature_id") or f"batch-{batch_id}"
                spec_data["creature_id"] = f"{base}-{index + 1}"
            elif not spec_data.get("creature_id"):
                spec_data["creature_id"] = None
            spec = CreatureSpec.model_validate(spec_data)
            spec.ensure_id()
            job_id = uuid.uuid4().hex
            stamp = now()
            store.insert_job(
                {
                    "id": job_id,
                    "creature_id": spec.creature_id,
                    "status": "pending",
                    "stage": "intake",
                    "batch_id": batch_id,
                    "created_at": stamp,
                    "updated_at": stamp,
                    "spec_json": spec.model_dump_json(),
                    "error": None,
                    "result_json": None,
                }
            )
            if sync:
                _execute(store, settings, spec, job_id)
            else:
                threading.Thread(target=_execute, args=(store, settings, spec, job_id), daemon=True).start()
            created.append(job_view(store.get_job(job_id)))
        return {"batch_id": batch_id, "jobs": created}

    return app


def _creature_dir(settings: Settings, creature_id: str) -> Path:
    if "/" in creature_id or "\\" in creature_id or creature_id in {"", ".", ".."}:
        raise HTTPException(400, "invalid creature id")
    return settings.output_dir / "creatures" / creature_id


def _execute(store: SqliteMetadata, settings: Settings, spec: CreatureSpec, job_id: str) -> None:
    def on_update(stage: str, status: str, attempt: int, message: str) -> None:
        del attempt
        store.update_job(job_id, status=status, stage=stage, updated_at=now(), error=message or None)

    try:
        result = execute_pipeline(spec, settings, job_id, on_update)
    except Exception as exc:
        store.update_job(job_id, status="failed", error=str(exc), updated_at=now(), stage="failed")
        return
    store.update_job(
        job_id,
        status=result["status"],
        stage=result.get("stage"),
        error=result.get("error"),
        updated_at=now(),
        result_json=json.dumps(result),
    )
    store.upsert_creature(
        {
            "id": spec.creature_id,
            "species": spec.species,
            "archetype": spec.archetype,
            "quality_score": result.get("quality_score"),
            "status": result["status"],
            "output_dir": result.get("output_dir"),
            "created_at": now(),
            "metadata_json": json.dumps({"quality_decision": result.get("quality_decision"), "generator": result.get("generator")}),
        }
    )
