"""Mesh processing: validation, quad check, UVs, and procedural PBR textures."""

from __future__ import annotations

import hashlib
import shutil

from creature_factory.adapters import find_blender
from creature_factory.mesh import boundary_and_nonmanifold, degenerate_quads, lod_subdiv_level, subdivide
from creature_factory.mesh.textures import write_pbr_textures
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json


def validate(ctx: PipelineContext) -> AgentResult:
    generated = ctx.generated
    if generated is None:
        raise RuntimeError("generate_3d did not produce a mesh")
    boundary, nonmanifold = boundary_and_nonmanifold(generated.mesh)
    if boundary or nonmanifold:
        raise RuntimeError(f"control mesh is open: boundary={len(boundary)} nonmanifold={len(nonmanifold)}")
    bad = degenerate_quads(generated.mesh)
    if bad:
        raise RuntimeError(f"control mesh has {len(bad)} degenerate quads")
    level = lod_subdiv_level(generated.mesh.triangle_count, int(ctx.profile["tri_min"]), int(ctx.profile["tri_max"]))
    chain = [generated.mesh]
    current = generated.mesh
    for _ in range(level):
        current = subdivide(current)
        chain.append(current)
    ctx.lods = {
        "lod0": chain[-1],
        "lod1": chain[max(len(chain) - 2, 0)],
        "lod2": chain[0],
        "lod3": generated.proxy,
        "subdiv_level": level,
    }
    return AgentResult(
        f"LOD0 {chain[-1].triangle_count} tris after {level} subdivision steps from {chain[0].triangle_count}"
    )


def retopo(ctx: PipelineContext) -> AgentResult:
    blender = find_blender(ctx.settings.blender_path)
    quad_count = len(ctx.lods["lod0"].quads)
    note = {
        "method": "offline_already_quad",
        "executed_blender": False,
        "executed_quadriflow": False,
        "blender": str(blender) if blender else None,
        "quadriflow": None if shutil.which("quadriflow") is None else shutil.which("quadriflow"),
        "quads": quad_count,
        "triangles": ctx.lods["lod0"].triangle_count,
        "detail": "Blender and QuadriFlow were not run. The generator already emits quads and subdivision keeps them.",
    }
    if blender is not None:
        note["detail"] = "Blender was found but this MVP does not dispatch a retopo job. The quad mesh is used as-is."
    ctx.notes["retopo"] = note
    dump_json(ctx.root / "mesh" / "retopo.json", note)
    return AgentResult(note["detail"])


def uv(ctx: PipelineContext) -> AgentResult:
    bad = 0
    for face in ctx.lods["lod0"].uvs:
        for u_coord, v_coord in face:
            if not (0.0 <= u_coord <= 1.0 and 0.0 <= v_coord <= 1.0):
                bad += 1
    if bad:
        raise RuntimeError(f"{bad} UV coordinates are outside 0-1")
    ctx.notes["uv"] = {"method": "part_atlas_from_generator", "out_of_range": 0}
    return AgentResult("UVs are inside the unit square")


def materials(ctx: PipelineContext) -> AgentResult:
    written = write_pbr_textures(
        ctx.root / "textures",
        ctx.spec.palette,
        ctx.spec.surface_material,
        ctx.spec.element,
        int(ctx.profile["texture_size"]),
        seed=int(hashlib.sha256(ctx.spec.creature_id.encode()).hexdigest()[:6], 16),
    )
    ctx.texture_paths = {name: ctx.root / "textures" / filename for name, filename in written.items()}
    material = {
        "name": ctx.spec.species,
        "shading": "pbr",
        "baseColor": "textures/basecolor.png",
        "normal": "textures/normal.png",
        "metallicRoughness": "textures/metallic_roughness.png",
        "size": int(ctx.profile["texture_size"]),
        "surface_material": ctx.spec.surface_material,
        "source": "procedural_numpy_pillow",
        "note": "Not a TRELLIS or Substance bake.",
    }
    dump_json(ctx.root / "materials" / "material.json", material)
    ctx.notes["material"] = material
    return AgentResult(f"wrote {ctx.profile['texture_size']}px PBR textures")
