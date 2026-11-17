"""Creature Designer. Expands a spec and refuses archetypes the MVP cannot build."""

from __future__ import annotations

from creature_factory.pipeline import AgentResult, PipelineContext, dump_json
from creature_factory.rig import ARCHETYPE_BONES, bones_as_json


def run(ctx: PipelineContext) -> AgentResult:
    info = ctx.settings.archetypes.get(ctx.spec.archetype, {})
    if ctx.spec.archetype == "quadruped":
        anatomy_ok = (
            ctx.spec.leg_count == 4
            and ctx.spec.head_count == 1
            and ctx.spec.tail_count == 1
            and ctx.spec.wing_count == 0
            and ctx.spec.extra_limbs == 0
        )
        anatomy_reason = (
            "MVP quadruped generator requires 4 legs, 1 head, 1 tail, 0 wings, and 0 extra limbs. "
            "A different skeleton was not invented for this request."
        )
    elif ctx.spec.archetype == "biped":
        anatomy_ok = (
            ctx.spec.leg_count == 2
            and ctx.spec.head_count == 1
            and ctx.spec.wing_count == 0
            and ctx.spec.extra_limbs == 0
        )
        anatomy_reason = (
            "MVP humanoid generator requires 2 legs, 1 head, 0 wings, and 0 extra limbs. "
            "Type 1 hero is the first supported biped pack."
        )
    else:
        anatomy_ok = False
        anatomy_reason = f"{ctx.spec.archetype} has a skeleton stub only. No mesh generator is implemented."
    implemented = bool(info.get("implemented")) and anatomy_ok
    if not anatomy_ok and ctx.spec.archetype in {"quadruped", "biped"}:
        reason = anatomy_reason
    elif not info.get("implemented"):
        reason = f"{ctx.spec.archetype} has a skeleton stub only. No mesh generator is implemented."
    else:
        reason = ""
    ctx.design = {
        "supported": implemented,
        "reason": reason,
        "species": ctx.spec.species,
        "archetype": ctx.spec.archetype,
        "body_structure": ctx.spec.body_structure,
        "element": ctx.spec.element,
        "rarity": ctx.spec.rarity,
        "surface_material": ctx.spec.surface_material,
        "palette": ctx.spec.palette,
        "horns": ctx.spec.horns,
        "spikes": ctx.spec.spikes,
        "armor": ctx.spec.armor,
        "accessories": ctx.spec.accessories,
        "prompt": ctx.spec.prompt,
        "style": ctx.spec.style,
        "generator": "offline_mvp" if implemented else "none",
        "quality_profile": ctx.profile["name"],
    }
    dump_json(ctx.root / "concept" / "design.json", ctx.design)
    if not implemented:
        bones = ARCHETYPE_BONES[ctx.spec.archetype]
        dump_json(
            ctx.root / "rig" / "skeleton.json",
            {
                "archetype": ctx.spec.archetype,
                "status": "stub",
                "implemented": False,
                "bones": bones_as_json(bones),
                "note": "Template only. It was not fitted to a mesh and Rigify did not run.",
            },
        )
        dump_json(
            ctx.root / "quality_report.json",
            {"score": 0, "decision": "reject", "reason": reason, "checks": [], "generator": "none"},
        )
        dump_json(
            ctx.root / "metadata.json",
            {
                "creature_id": ctx.spec.creature_id,
                "species": ctx.spec.species,
                "archetype": ctx.spec.archetype,
                "status": "rejected",
                "generator": "none",
                "generator_note": reason,
                "quality_score": 0,
                "quality_decision": "reject",
            },
        )
        ctx.stop = True
        ctx.stop_status = "rejected"
        ctx.final_status = "rejected"
        return AgentResult(reason)
    label = "humanoid hero" if ctx.spec.archetype == "biped" else "quadruped"
    return AgentResult(f"design accepted for the offline {label} generator")
