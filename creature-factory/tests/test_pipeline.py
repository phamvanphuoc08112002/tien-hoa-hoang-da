"""Pipeline, retry, and archetype stub tests. No GPU, Redis, or Unreal."""

import json
from pathlib import Path

from creature_factory.agents.base import AgentResult
from creature_factory.agents.manager import run_stages
from creature_factory.config import load_settings
from creature_factory.mesh import lod_subdiv_level, subdivide_times
from creature_factory.mesh.quadruped import generate_quadruped
from creature_factory.pipeline import PipelineContext
from creature_factory.pipeline.engine import execute_pipeline
from creature_factory.specs import CreatureSpec, sample_emberback


def _settings(tmp_path: Path):
    settings = load_settings()
    settings.output_dir = tmp_path / "out"
    settings.database_path = tmp_path / "factory.sqlite"
    settings.quality_profile = "preview"
    return settings


def test_retry_then_continue(tmp_path):
    settings = _settings(tmp_path)
    spec = sample_emberback("preview")
    ctx = PipelineContext(spec=spec, settings=settings, profile=settings.profile("preview"), job_id="retry", root=tmp_path / "job")
    state = {"n": 0}

    def flaky(_ctx):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("transient write error")
        return AgentResult("recovered")

    result = run_stages([("demo", flaky)], ctx, max_retries=2)
    assert result["status"] == "completed"
    assert state["n"] == 2
    assert "transient write error" in (tmp_path / "job" / "logs" / "pipeline.jsonl").read_text(encoding="utf-8")


def test_biped_is_a_stub(tmp_path):
    settings = _settings(tmp_path)
    spec = CreatureSpec(species="Walker", archetype="biped", quality_profile="preview")
    result = execute_pipeline(spec, settings, "biped-job")
    assert result["status"] == "rejected"
    folder = Path(result["output_dir"])
    assert (folder / "rig" / "skeleton.json").is_file()
    assert not (folder / "mesh" / "creature.gltf").exists()
    skeleton = json.loads((folder / "rig" / "skeleton.json").read_text(encoding="utf-8"))
    assert skeleton["status"] == "stub"
    assert skeleton["bones"][0]["name"] == "root"
    assert "thigh_fl" not in {bone["name"] for bone in skeleton["bones"]}


def test_preview_quadruped_pipeline(tmp_path):
    settings = _settings(tmp_path)
    spec = sample_emberback("preview")
    spec.creature_id = "CR-quadruped-emberback-test"
    result = execute_pipeline(spec, settings, "preview-job")
    assert result["status"] == "completed", result
    assert result["generator"] == "offline_mvp"
    assert result["orchestrator"] == "builtin"
    assert result["quality_decision"] == "accept"
    assert result["quality_score"] >= 85
    folder = Path(result["output_dir"])
    required = [
        "concept/concept.png",
        "concept/concept.json",
        "concept/design.json",
        "concept/mesh_preview.png",
        "mesh/creature.gltf",
        "mesh/creature.bin",
        "mesh/lod0.gltf",
        "mesh/lod1.gltf",
        "mesh/lod2.gltf",
        "mesh/lod3.gltf",
        "mesh/collision.gltf",
        "mesh/retopo.json",
        "textures/basecolor.png",
        "textures/normal.png",
        "textures/metallic_roughness.png",
        "materials/material.json",
        "rig/skeleton.json",
        "rig/weights.npz",
        "rig/weights_summary.json",
        "animations/idle.json",
        "animations/walk.json",
        "animations/run.json",
        "animations/jump.json",
        "animations/attack.json",
        "animations/hit.json",
        "animations/death.json",
        "unreal/import_creature.py",
        "unreal/physics_asset.json",
        "unreal/anim_blueprint.json",
        "unreal/status.json",
        "metadata.json",
        "quality_report.json",
        "logs/pipeline.jsonl",
    ]
    for relative in required:
        assert (folder / relative).is_file(), relative
    meta = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
    assert meta["generator"] == "offline_mvp"
    assert "TRELLIS" in meta["generator_note"]
    assert meta["animations"] == ["idle", "walk", "run", "jump", "attack", "hit", "death"]
    status = json.loads((folder / "unreal" / "status.json").read_text(encoding="utf-8"))
    assert status["executed"] is False
    retopo = json.loads((folder / "mesh" / "retopo.json").read_text(encoding="utf-8"))
    assert retopo["executed_blender"] is False
    gltf = json.loads((folder / "mesh" / "creature.gltf").read_text(encoding="utf-8"))
    assert [clip["name"] for clip in gltf["animations"]] == meta["animations"]
    assert gltf["asset"]["generator"].startswith("creature-factory offline_mvp")
    report = json.loads((folder / "quality_report.json").read_text(encoding="utf-8"))
    assert all(check["passed"] for check in report["checks"])


def test_stylized_triangle_budget():
    generated = generate_quadruped(sample_emberback("stylized_aaa"))
    profile = load_settings().profile("stylized_aaa")
    level = lod_subdiv_level(generated.mesh.triangle_count, profile["tri_min"], profile["tri_max"])
    hero = subdivide_times(generated.mesh, level)
    assert profile["tri_min"] <= hero.triangle_count <= profile["tri_max"]
