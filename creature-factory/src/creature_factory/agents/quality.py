"""Quality control agent."""

from __future__ import annotations

from creature_factory.pipeline import AgentResult, PipelineContext, dump_json
from creature_factory.qc import evaluate_creature


def run(ctx: PipelineContext) -> AgentResult:
    report = evaluate_creature(
        lod0=ctx.lods["lod0"],
        control=ctx.generated.mesh,
        skeleton=ctx.skeleton,
        clips=ctx.clips,
        profile=ctx.profile,
        texture_paths=ctx.texture_paths,
        gltf_path=ctx.root / "mesh" / "creature.gltf",
    )
    report["creature_id"] = ctx.spec.creature_id
    report["qc_loop"] = ctx.qc_loops
    ctx.qc_report = report
    dump_json(ctx.root / "quality_report.json", report)
    if report["decision"] != "accept":
        if report.get("loop_to") and ctx.qc_loops < 1:
            ctx.qc_loops += 1
            return AgentResult(f"score {report['score']} rejected; looping to {report['loop_to']}", loop_to=report["loop_to"])
        ctx.final_status = "rejected"
        return AgentResult(f"quality rejected the creature with score {report['score']}")
    ctx.final_status = "completed"
    return AgentResult(f"quality accepted with score {report['score']}")
