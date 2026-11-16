"""Honest probes. A tool is available only when this machine can actually see it."""

from __future__ import annotations

import importlib.util
import os
import shutil
import socket
from pathlib import Path
from urllib.parse import urlparse

from creature_factory.config import Settings


class AdapterUnavailable(RuntimeError):
    def __init__(self, tool: str, detail: str) -> None:
        self.tool = tool
        super().__init__(f"{tool} is not available: {detail}")


def _tcp(host: str, port: int, timeout: float = 0.25) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def find_blender(explicit: str | None = None) -> Path | None:
    candidates = [explicit, os.environ.get("BLENDER_EXE"), shutil.which("blender")]
    root = Path(r"C:\Program Files\Blender Foundation")
    if root.is_dir():
        candidates.extend(str(path) for path in root.glob("*/blender.exe"))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def find_unreal() -> Path | None:
    found = shutil.which("UnrealEditor")
    if found:
        return Path(found)
    root = Path(r"C:\Program Files\Epic Games")
    if root.is_dir():
        matches = list(root.glob("UE_*/Engine/Binaries/Win64/UnrealEditor.exe"))
        if matches:
            return matches[0]
    return None


def probe_environment(settings: Settings) -> list[dict]:
    blender = find_blender(settings.blender_path)
    unreal = find_unreal()
    redis = _probe_redis()
    comfy = urlparse(settings.comfyui_url)
    postgres = urlparse(settings.postgres_dsn)
    minio = urlparse(settings.minio_endpoint)
    comfy_up = _tcp(comfy.hostname or "127.0.0.1", comfy.port or 8188)
    postgres_up = _tcp(postgres.hostname or "127.0.0.1", postgres.port or 5432)
    minio_up = _tcp(minio.hostname or "127.0.0.1", minio.port or 9000)
    return [
        {
            "name": "offline_mvp",
            "available": True,
            "used_by_pipeline": settings.generator == "offline_mvp",
            "detail": "Pure Python quadruped mesh, PBR images, skeleton, skin weights, and seven animation clips.",
        },
        {
            "name": "trellis2",
            "available": _module("trellis") or _module("trellis2"),
            "used_by_pipeline": False,
            "detail": "TRELLIS.2 Python package is not installed. No checkpoint was downloaded and no image-to-3D call is made.",
        },
        {
            "name": "comfyui",
            "available": comfy_up,
            "used_by_pipeline": False,
            "detail": (
                "A process accepted a TCP connection, but this MVP has no verified ComfyUI workflow and does not submit prompts."
                if comfy_up
                else f"No ComfyUI server at {settings.comfyui_url}. Concept art is drawn with Pillow."
            ),
        },
        {
            "name": "blender",
            "available": blender is not None,
            "used_by_pipeline": False,
            "detail": f"Blender executable: {blender}" if blender else "blender.exe was not found on PATH or under Program Files. bpy was not executed.",
        },
        {
            "name": "quadriflow",
            "available": shutil.which("quadriflow") is not None,
            "used_by_pipeline": False,
            "detail": "QuadriFlow binary not on PATH. The offline mesh is already quads, so no remesh was run.",
        },
        {
            "name": "rigify",
            "available": blender is not None,
            "used_by_pipeline": False,
            "detail": "Rigify ships with Blender. Blender is absent, so the quadruped uses the custom skeleton template.",
        },
        {
            "name": "unreal",
            "available": unreal is not None,
            "used_by_pipeline": False,
            "detail": f"Unreal Editor: {unreal}" if unreal else "UnrealEditor.exe was not found. Python import notes are written and not executed.",
        },
        {
            "name": "langgraph",
            "available": _module("langgraph"),
            "used_by_pipeline": False,
            "detail": "LangGraph is not installed. Stage order, retries, and loop-back run in creature_factory.pipeline.engine.",
        },
        {
            "name": "celery",
            "available": _module("celery"),
            "used_by_pipeline": False,
            "detail": "The celery package is not installed. Jobs run inline in the API process.",
        },
        {
            "name": "redis",
            "available": redis,
            "used_by_pipeline": False,
            "detail": (
                "Redis answered PING. The Python redis client is not required because the active job backend is inline."
                if redis
                else "Redis did not answer PING. The inline job runner does not need it."
            ),
        },
        {
            "name": "postgres",
            "available": postgres_up and (_module("psycopg") or _module("psycopg2")),
            "used_by_pipeline": False,
            "detail": "PostgreSQL is not used. Metadata is a SQLite file. No psql client was found."
            if not postgres_up or shutil.which("psql") is None
            else "PostgreSQL accepted a connection.",
        },
        {
            "name": "minio",
            "available": minio_up and _module("minio"),
            "used_by_pipeline": False,
            "detail": "MinIO/S3 is not used. Creature folders are written on the local disk.",
        },
        {
            "name": "jobs",
            "available": True,
            "active": "inline",
            "used_by_pipeline": True,
            "detail": "Inline runner executes the 13 stages in-process. Celery is not queued.",
        },
        {
            "name": "metadata",
            "available": True,
            "active": "sqlite",
            "used_by_pipeline": True,
            "detail": f"SQLite database at {settings.database_path}.",
        },
        {
            "name": "storage",
            "available": True,
            "active": "local",
            "used_by_pipeline": True,
            "detail": f"Local directory {settings.output_dir}.",
        },
    ]


def _probe_redis() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 6379), timeout=0.25) as sock:
            sock.sendall(b"PING\r\n")
            data = sock.recv(32)
        return b"PONG" in data
    except OSError:
        return False


class TrellisAdapter:
    name = "trellis2"

    def generate(self, image_path: Path, output_dir: Path) -> None:
        del image_path, output_dir
        raise AdapterUnavailable(
            "TRELLIS.2",
            "package is not installed and no weights were downloaded. Use generator=offline_mvp.",
        )


class ComfyUIAdapter:
    name = "comfyui"

    def __init__(self, url: str) -> None:
        self.url = url

    def render(self, prompt: str, output_path: Path) -> None:
        del prompt, output_path
        raise AdapterUnavailable(
            "ComfyUI",
            f"no verified workflow is wired for {self.url}. The factory draws a procedural concept instead.",
        )


class CeleryQueue:
    name = "celery"

    def submit(self, job_id: str) -> None:
        del job_id
        raise AdapterUnavailable("Celery", "celery is not installed. Set job_backend to inline.")


class PostgresStore:
    name = "postgres"

    def __init__(self, dsn: str) -> None:
        raise AdapterUnavailable(
            "PostgreSQL",
            f"server/client libraries are not available for {dsn}. metadata_backend=sqlite is the working store.",
        )


class MinioStore:
    name = "minio"

    def __init__(self, endpoint: str) -> None:
        raise AdapterUnavailable(
            "MinIO",
            f"endpoint {endpoint} is not in use. storage_backend=local writes the creature folder to disk.",
        )
