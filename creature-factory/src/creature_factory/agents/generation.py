"""3D generation. TRELLIS when configured and available; otherwise offline procedural mesh."""

from __future__ import annotations

from creature_factory.adapters import AdapterUnavailable, TrellisAdapter
from creature_factory.mesh.humanoid import generate_humanoid
from creature_factory.mesh.quadruped import generate_quadruped
from creature_factory.pipeline import AgentResult, PipelineContext


def run(ctx: PipelineContext) -> AgentResult:
    concept = ctx.root / "concept" / "concept.png"
    mesh_dir = ctx.root / "mesh"
    trellis_note = None
    if ctx.settings.generator == "trellis2":
        try:
            TrellisAdapter(
                comfyui_url=ctx.settings.comfyui_url,
                workflows_dir=ctx.settings.project_root / "workflows",
            ).generate(concept, mesh_dir)
        except AdapterUnavailable as exc:
            trellis_note = str(exc)
            # Hard fail when the user explicitly asked for TRELLIS.
            raise
    if ctx.settings.generator not in {"offline_mvp", "trellis2"}:
        raise AdapterUnavailable(ctx.settings.generator, "only offline_mvp and trellis2 are configured")

    if ctx.spec.archetype == "biped":
        ctx.generated = generate_humanoid(ctx.spec)
        kind = "humanoid"
    else:
        ctx.generated = generate_quadruped(ctx.spec)
        kind = "quadruped"
    generated = ctx.generated
    assert generated is not None
    message = f"offline {kind} control mesh {generated.mesh.triangle_count} triangles"
    if ctx.settings.generator == "trellis2":
        message = f"TRELLIS path selected; {trellis_note or 'completed'}"
    else:
        message += "; TRELLIS.2 did not run"
    return AgentResult(message)
