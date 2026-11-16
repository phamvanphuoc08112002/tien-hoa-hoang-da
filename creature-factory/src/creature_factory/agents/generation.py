"""3D generation agent. The configured offline generator is the only path that runs."""

from __future__ import annotations

from creature_factory.adapters import AdapterUnavailable, TrellisAdapter
from creature_factory.mesh.quadruped import generate_quadruped
from creature_factory.pipeline import AgentResult, PipelineContext


def run(ctx: PipelineContext) -> AgentResult:
    if ctx.settings.generator == "trellis2":
        TrellisAdapter().generate(ctx.root / "concept" / "concept.png", ctx.root / "mesh")
    if ctx.settings.generator != "offline_mvp":
        raise AdapterUnavailable(ctx.settings.generator, "only offline_mvp is implemented")
    ctx.generated = generate_quadruped(ctx.spec)
    generated = ctx.generated
    assert generated is not None
    return AgentResult(
        f"offline quadruped control mesh {generated.mesh.triangle_count} triangles; TRELLIS.2 did not run"
    )
