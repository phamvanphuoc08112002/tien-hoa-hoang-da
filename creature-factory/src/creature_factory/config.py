"""Load factory settings from YAML. Paths stay inside the project unless overridden."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

PACKAGE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_DIR.parents[1]


def _load_yaml(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a mapping")
    return data


@dataclass
class Settings:
    project_root: Path
    generator: str = "offline_mvp"
    job_backend: str = "inline"
    metadata_backend: str = "sqlite"
    storage_backend: str = "local"
    quality_profile: str = "stylized_aaa"
    max_retries: int = 2
    host: str = "127.0.0.1"
    port: int = 8765
    redis_url: str = "redis://127.0.0.1:6379/0"
    postgres_dsn: str = ""
    minio_endpoint: str = "http://127.0.0.1:9000"
    comfyui_url: str = "http://127.0.0.1:8188"
    blender_path: str | None = None
    output_dir: Path = field(default_factory=lambda: PROJECT_ROOT / "outputs")
    database_path: Path = field(default_factory=lambda: PROJECT_ROOT / "data" / "factory.sqlite")
    profiles: dict = field(default_factory=dict)
    archetypes: dict = field(default_factory=dict)

    def profile(self, name: str | None = None) -> dict:
        key = name or self.quality_profile
        if key not in self.profiles:
            known = ", ".join(sorted(self.profiles))
            raise KeyError(f"unknown quality profile {key!r}; known: {known}")
        data = dict(self.profiles[key])
        data["name"] = key
        return data

    def creature_root(self, creature_id: str) -> Path:
        return self.output_dir / "creatures" / creature_id


def load_settings(root: Path | None = None) -> Settings:
    project = (root or PROJECT_ROOT).resolve()
    raw = _load_yaml(project / "config" / "default.yaml")
    profiles = _load_yaml(project / "config" / "quality_profiles.yaml").get("profiles", {})
    archetypes = _load_yaml(project / "config" / "archetypes.yaml").get("archetypes", {})
    output = Path(raw.get("output_dir", "outputs"))
    database = Path(raw.get("database_path", "data/factory.sqlite"))
    if not output.is_absolute():
        output = project / output
    if not database.is_absolute():
        database = project / database
    return Settings(
        project_root=project,
        generator=str(raw.get("generator", "offline_mvp")),
        job_backend=str(raw.get("job_backend", "inline")),
        metadata_backend=str(raw.get("metadata_backend", "sqlite")),
        storage_backend=str(raw.get("storage_backend", "local")),
        quality_profile=str(raw.get("quality_profile", "stylized_aaa")),
        max_retries=int(raw.get("max_retries", 2)),
        host=str(raw.get("host", "127.0.0.1")),
        port=int(raw.get("port", 8765)),
        redis_url=str(raw.get("redis_url", "")),
        postgres_dsn=str(raw.get("postgres_dsn", "")),
        minio_endpoint=str(raw.get("minio_endpoint", "")),
        comfyui_url=str(raw.get("comfyui_url", "")),
        blender_path=raw.get("blender_path") or None,
        output_dir=output,
        database_path=database,
        profiles=profiles,
        archetypes=archetypes,
    )
