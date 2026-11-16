"""Manager agent: intake, packaging, and the stage runner."""

from __future__ import annotations

from creature_factory.adapters import probe_environment
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json, now


def intake(ctx: PipelineContext) -> AgentResult:
    ctx.ensure_dirs()
    ctx.spec.ensure_id()
    ctx.tool_report = probe_environment(ctx.settings)
    ctx.log("intake", f"opened {ctx.root}")
    return AgentResult(f"intake {ctx.spec.creature_id} profile {ctx.profile['name']}")


def package(ctx: PipelineContext) -> AgentResult:
    files = sorted(
        path.relative_to(ctx.root).as_posix()
        for path in ctx.root.rglob("*")
        if path.is_file() and path.name != "metadata.json"
    )
    report = ctx.qc_report or {}
    metadata = {
        "creature_id": ctx.spec.creature_id,
        "species": ctx.spec.species,
        "archetype": ctx.spec.archetype,
        "status": ctx.final_status,
        "created_at": now(),
        "generator": "offline_mvp",
        "generator_note": (
            "Pure Python mesh, procedural PBR textures, custom skeleton, skin weights, "
            "and sampled animation curves. TRELLIS.2 did not run. Blender, QuadriFlow, "
            "Rigify, and Unreal were not executed."
        ),
        "quality_profile": ctx.profile["name"],
        "quality_score": report.get("score"),
        "quality_decision": report.get("decision"),
        "prompt": ctx.spec.prompt,
        "style": ctx.spec.style,
        "category": ctx.spec.category,
        "element": ctx.spec.element,
        "rarity": ctx.spec.rarity,
        "surface_material": ctx.spec.surface_material,
        "palette": ctx.spec.palette,
        "body": {
            "structure": ctx.spec.body_structure,
            "legs": ctx.spec.leg_count,
            "heads": ctx.spec.head_count,
            "tails": ctx.spec.tail_count,
            "wings": ctx.spec.wing_count,
            "extra_limbs": ctx.spec.extra_limbs,
            "horns": ctx.spec.horns,
            "spikes": ctx.spec.spikes,
            "armor": ctx.spec.armor,
            "accessories": ctx.spec.accessories,
        },
        "animations": list(ctx.clips) if ctx.clips else [],
        "polycount": {name: ctx.lods[name].triangle_count for name in ("lod0", "lod1", "lod2", "lod3")} if ctx.lods else {},
        "textures": {"size": ctx.profile["texture_size"], "source": "procedural_numpy_pillow"},
        "external_tools": ctx.tool_report,
        "stage_notes": ctx.notes,
        "stages": ctx.stages_run,
        "files": files,
    }
    dump_json(ctx.root / "metadata.json", metadata)
    return AgentResult(f"packaged {len(files)} files, decision {metadata['quality_decision']}")


def run_stages(steps: list[tuple[str, callable]], ctx: PipelineContext, max_retries: int, on_update=None) -> dict:
    index = 0
    names = [name for name, _fn in steps]
    attempts = {name: 0 for name in names}
    while index < len(steps):
        name, fn = steps[index]
        attempts[name] += 1
        state = "running" if attempts[name] == 1 else "retrying"
        if on_update:
            on_update(name, state, attempts[name], "")
        try:
            result = fn(ctx)
        except Exception as exc:
            ctx.log(name, f"error: {exc}", attempt=attempts[name])
            if attempts[name] > max_retries:
                ctx.final_status = "failed"
                return {
                    "status": "failed",
                    "stage": name,
                    "error": str(exc),
                    "attempts": attempts,
                    "creature_id": ctx.spec.creature_id,
                }
            continue
        if result is None:
            result = AgentResult("ok")
        ctx.stages_run.append(name)
        ctx.log(name, result.message, attempt=attempts[name])
        if ctx.stop:
            return {
                "status": ctx.stop_status,
                "stage": name,
                "error": ctx.design.get("reason") if ctx.design else result.message,
                "attempts": attempts,
                "creature_id": ctx.spec.creature_id,
            }
        if result.loop_to:
            if result.loop_to not in attempts:
                raise RuntimeError(f"unknown loop target {result.loop_to}")
            if attempts[result.loop_to] > max_retries:
                ctx.final_status = "rejected"
                return {
                    "status": "rejected",
                    "stage": name,
                    "error": f"retry limit while returning to {result.loop_to}",
                    "attempts": attempts,
                    "creature_id": ctx.spec.creature_id,
                }
            index = names.index(result.loop_to)
            continue
        index += 1
    return {
        "status": ctx.final_status,
        "stage": names[-1],
        "error": None if ctx.final_status == "completed" else "quality rejected the creature",
        "attempts": attempts,
        "creature_id": ctx.spec.creature_id,
        "quality_score": None if not ctx.qc_report else ctx.qc_report.get("score"),
        "quality_decision": None if not ctx.qc_report else ctx.qc_report.get("decision"),
    }
