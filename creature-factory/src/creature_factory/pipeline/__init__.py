"""Shared job context passed between agents."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from creature_factory.config import Settings
from creature_factory.specs import CreatureSpec

FOLDERS = ("concept", "mesh", "textures", "materials", "rig", "animations", "unreal", "logs")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def dump_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


@dataclass
class AgentResult:
    message: str
    loop_to: str | None = None


@dataclass
class PipelineContext:
    spec: CreatureSpec
    settings: Settings
    profile: dict
    job_id: str
    root: Path
    logs: list[dict] = field(default_factory=list)
    design: dict | None = None
    generated: object | None = None
    lods: dict | None = None
    skeleton: object | None = None
    clips: dict | None = None
    texture_paths: dict | None = None
    qc_report: dict | None = None
    qc_loops: int = 0
    tool_report: list | None = None
    notes: dict = field(default_factory=dict)
    stages_run: list[str] = field(default_factory=list)
    stop: bool = False
    stop_status: str = "completed"
    final_status: str = "completed"

    def ensure_dirs(self) -> None:
        for folder in FOLDERS:
            (self.root / folder).mkdir(parents=True, exist_ok=True)

    def log(self, stage: str, message: str, **extra) -> None:
        entry = {"time": now(), "stage": stage, "message": message, **extra}
        self.logs.append(entry)
        path = self.root / "logs" / "pipeline.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
