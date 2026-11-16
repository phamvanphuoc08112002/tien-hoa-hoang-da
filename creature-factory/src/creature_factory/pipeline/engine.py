"""Builtin stage orchestrator. LangGraph is not installed and is not invoked."""

from __future__ import annotations

from creature_factory.agents import animation, concept_artist, designer, generation, mesh_agent, publisher, quality, rigging
from creature_factory.agents.manager import intake, package, run_stages
from creature_factory.config import Settings
from creature_factory.pipeline import PipelineContext
from creature_factory.specs import CreatureSpec

STAGE_COUNT = 13


def build_steps():
    return [
        ("intake", intake),
        ("design", designer.run),
        ("concept", concept_artist.run),
        ("generate_3d", generation.run),
        ("mesh_validate", mesh_agent.validate),
        ("retopo", mesh_agent.retopo),
        ("uv", mesh_agent.uv),
        ("materials", mesh_agent.materials),
        ("rig", rigging.run),
        ("animate", animation.run),
        ("export", publisher.run),
        ("quality", quality.run),
        ("package", package),
    ]


def execute_pipeline(spec: CreatureSpec, settings: Settings, job_id: str, on_update=None) -> dict:
    profile_name = spec.quality_profile or settings.quality_profile
    profile = settings.profile(profile_name)
    root = settings.creature_root(spec.ensure_id())
    if root.exists():
        # A stable sample id is allowed to be regenerated.
        import shutil

        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)
    ctx = PipelineContext(spec=spec, settings=settings, profile=profile, job_id=job_id, root=root)
    result = run_stages(build_steps(), ctx, settings.max_retries, on_update)
    result["output_dir"] = str(root)
    result["stage_count"] = STAGE_COUNT
    result["orchestrator"] = "builtin"
    result["generator"] = "offline_mvp" if result["status"] != "rejected" else ctx.design.get("generator") if ctx.design else "none"
    return result
