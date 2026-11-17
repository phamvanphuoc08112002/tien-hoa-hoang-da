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


def _trellis_probe_detail(settings: Settings) -> str:
    vram = _gpu_vram_mb()
    has_pkg = _module("trellis") or _module("trellis2")
    has_workflow = (settings.project_root / "workflows" / "trellis_image_to_3d_api.json").is_file()
    if vram is not None and vram < 8000:
        return (
            f"Local GPU has ~{vram} MB VRAM; TRELLIS.2 needs ~8000+ MB. "
            "Not available on this GPU. Use a remote comfyui_url or offline_mvp."
        )
    if has_pkg or has_workflow:
        return "TRELLIS adapter is wired. Package/workflow present; run with generator=trellis2 when ComfyUI is ready."
    return "TRELLIS.2 is not installed. No weights downloaded. Image-to-3D is not run."


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
            "available": False,
            "used_by_pipeline": settings.generator == "trellis2",
            "detail": _trellis_probe_detail(settings),
        },
        {
            "name": "comfyui",
            "available": comfy_up,
            "used_by_pipeline": False,
            "detail": (
                f"ComfyUI is up at {settings.comfyui_url}. Concept stage will POST workflows/concept_hero_api.json when the checkpoint exists."
                if comfy_up
                else f"No ComfyUI server at {settings.comfyui_url}. Concept art falls back to Pillow. Run scripts/setup_comfyui.ps1."
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


def _gpu_vram_mb() -> int | None:
    """Best-effort local VRAM probe via nvidia-smi. None if unavailable."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        import subprocess

        out = subprocess.check_output(
            [exe, "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=3,
        )
        first = out.strip().splitlines()[0].strip()
        return int(float(first))
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return None


class TrellisAdapter:
    name = "trellis2"
    MIN_VRAM_MB = 8000

    def __init__(self, comfyui_url: str = "http://127.0.0.1:8188", workflows_dir: Path | None = None) -> None:
        self.comfyui_url = comfyui_url
        self.workflows_dir = workflows_dir

    def generate(self, image_path: Path | str, output_dir: Path | str) -> Path:
        """Image-to-3D. Requires enough VRAM plus either a trellis package or a ComfyUI workflow."""
        image_path = Path(image_path)
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        vram = _gpu_vram_mb()
        if vram is not None and vram < self.MIN_VRAM_MB:
            raise AdapterUnavailable(
                "TRELLIS.2",
                f"local GPU has ~{vram} MB VRAM; TRELLIS.2 needs about {self.MIN_VRAM_MB}+ MB. "
                "Point comfyui_url at a remote ComfyUI with TRELLIS, or keep generator=offline_mvp.",
            )
        if not image_path.is_file():
            raise AdapterUnavailable("TRELLIS.2", f"concept image missing: {image_path}")
        workflow_path = None
        if self.workflows_dir is not None:
            candidate = self.workflows_dir / "trellis_image_to_3d_api.json"
            if candidate.is_file():
                workflow_path = candidate
        if workflow_path is None:
            detail = (
                "no workflows/trellis_image_to_3d_api.json. "
                "Install ComfyUI-TRELLIS on a GPU with 8GB+ VRAM, export the API workflow, then retry."
            )
            if _module("trellis") or _module("trellis2"):
                detail = (
                    "a trellis package name was found, but no verified Python entrypoint is wired yet. "
                    "Export a ComfyUI TRELLIS API workflow to workflows/trellis_image_to_3d_api.json."
                )
            raise AdapterUnavailable("TRELLIS.2", detail)

        from creature_factory.adapters.comfyui_client import ComfyUIClient, load_workflow

        client = ComfyUIClient(self.comfyui_url)
        if not client.alive():
            raise AdapterUnavailable("TRELLIS.2", f"ComfyUI is not reachable at {self.comfyui_url}")
        workflow = load_workflow(workflow_path)
        load_nodes = [nid for nid, node in workflow.items() if node.get("class_type") == "LoadImage"]
        if not load_nodes:
            raise AdapterUnavailable("TRELLIS.2", "TRELLIS workflow has no LoadImage node")
        workflow[load_nodes[0]]["inputs"]["image"] = image_path.name
        prompt_id = client.queue_prompt(workflow)
        client.wait_history(prompt_id, timeout_s=1800.0)
        # Custom TRELLIS nodes write meshes outside /view; operator copies GLB into output_dir.
        raise AdapterUnavailable(
            "TRELLIS.2",
            f"ComfyUI prompt {prompt_id} finished, but automatic GLB harvest is not wired for your "
            f"custom node. Copy the exported mesh into {output_dir} and re-run with generator=offline_mvp "
            "only for rig/anim, or extend TrellisAdapter for your node outputs.",
        )


class ComfyUIAdapter:
    name = "comfyui"

    def __init__(self, url: str, workflows_dir: Path | None = None) -> None:
        self.url = url
        self.workflows_dir = workflows_dir

    def render(self, prompt: str, output_path: Path, negative: str | None = None, seed: int = 42) -> Path:
        from creature_factory.adapters.comfyui_client import (
            ComfyUIClient,
            load_workflow,
            set_prompt_text,
            set_seed,
        )

        client = ComfyUIClient(self.url)
        if not client.alive():
            raise AdapterUnavailable("ComfyUI", f"server not reachable at {self.url}")
        workflow_path = None
        if self.workflows_dir is not None:
            for name in ("concept_hero_api.json", "concept_api.json"):
                candidate = self.workflows_dir / name
                if candidate.is_file():
                    workflow_path = candidate
                    break
        if workflow_path is None:
            raise AdapterUnavailable(
                "ComfyUI",
                f"no concept workflow JSON under {self.workflows_dir}. Expected concept_hero_api.json.",
            )
        workflow = load_workflow(workflow_path)
        set_prompt_text(
            workflow,
            prompt,
            negative
            or "lowres, blurry, deformed, extra limbs, bad anatomy, watermark, text, 3d render artifact",
        )
        set_seed(workflow, seed)
        return client.run_workflow_to_image(workflow, output_path)


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
