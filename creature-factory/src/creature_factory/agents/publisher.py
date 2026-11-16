"""Export glTF, LODs, collision, preview, and unexecuted Unreal notes."""

from __future__ import annotations

from creature_factory.export.gltf_writer import write_gltf
from creature_factory.mesh.preview import render_preview
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json


def _texture_uris() -> dict[str, str]:
    return {
        "baseColor": "../textures/basecolor.png",
        "metallicRoughness": "../textures/metallic_roughness.png",
        "normal": "../textures/normal.png",
    }


def run(ctx: PipelineContext) -> AgentResult:
    uris = _texture_uris()
    mesh_dir = ctx.root / "mesh"
    write_gltf(mesh_dir / "creature.gltf", ctx.lods["lod0"], ctx.skeleton, ctx.clips, uris)
    for name in ("lod0", "lod1", "lod2", "lod3"):
        write_gltf(mesh_dir / f"{name}.gltf", ctx.lods[name], ctx.skeleton, None, uris)
    write_gltf(mesh_dir / "collision.gltf", ctx.lods["lod3"], None, None, None)
    render_preview(ctx.generated.mesh, ctx.root / "concept" / "mesh_preview.png")
    counts = {name: ctx.lods[name].triangle_count for name in ("lod0", "lod1", "lod2", "lod3")}
    dump_json(mesh_dir / "mesh_stats.json", {"triangles": counts, "subdiv_level": ctx.lods["subdiv_level"], "format": "glTF 2.0"})
    _write_unreal(ctx, counts)
    return AgentResult("exported glTF LODs, collision, and Unreal notes that were not executed")


def _write_unreal(ctx: PipelineContext, counts: dict) -> None:
    creature_id = ctx.spec.creature_id
    gltf = (ctx.root / "mesh" / "creature.gltf").resolve()
    script = f'''"""Unreal Editor import notes for {creature_id}.

Creature Factory did NOT execute this file. Unreal Editor was not launched.
Run it yourself from the Unreal Python console after checking the path.
"""

def import_creature():
    import unreal

    task = unreal.AssetImportTask()
    task.filename = r"{gltf}"
    task.destination_path = "/Game/Creatures/{creature_id}"
    task.destination_name = "{creature_id}"
    task.automated = True
    task.save = True
    task.replace_existing = True
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    unreal.log("Imported glTF. Build the Physics Asset and AnimBP from the JSON files beside this script.")


if __name__ == "__main__":
    import_creature()
'''
    path = ctx.root / "unreal" / "import_creature.py"
    path.write_text(script, encoding="utf-8")
    skeleton = ctx.skeleton
    bodies = []
    for bone, shape, size in (
        ("spine_02", "box", 0.22),
        ("head", "sphere", 0.16),
        ("thigh_fl", "capsule", 0.06),
        ("thigh_fr", "capsule", 0.06),
        ("thigh_hl", "capsule", 0.06),
        ("thigh_hr", "capsule", 0.06),
    ):
        bodies.append(
            {
                "bone": bone,
                "shape": shape,
                "radius_or_extent": round(size * skeleton.scale, 4),
                "rest": [round(float(v), 4) for v in skeleton.rest_world[bone]],
            }
        )
    dump_json(
        ctx.root / "unreal" / "physics_asset.json",
        {
            "executed": False,
            "collision_mesh": "mesh/collision.gltf",
            "bodies": bodies,
            "note": "Description only. No Physics Asset was created in Unreal.",
        },
    )
    dump_json(
        ctx.root / "unreal" / "anim_blueprint.json",
        {
            "executed": False,
            "skeleton": "rig/skeleton.json",
            "default_state": "idle",
            "states": ["idle", "walk", "run", "jump", "attack", "hit", "death"],
            "note": "State list for a future AnimBP. It was not compiled.",
        },
    )
    dump_json(
        ctx.root / "unreal" / "status.json",
        {
            "executed": False,
            "skeletal_mesh_created": False,
            "physics_asset_created": False,
            "anim_blueprint_created": False,
            "lods_assigned": False,
            "reason": "Unreal Editor is not installed. import_creature.py was written and not run.",
            "lod_triangles": counts,
        },
    )
