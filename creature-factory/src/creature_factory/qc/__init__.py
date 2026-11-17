"""Quality checks that run on the files this factory actually wrote."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from creature_factory.anim.clips import CLIP_NAMES, Clip
from creature_factory.anim.humanoid_clips import HUMANOID_CLIP_NAMES
from creature_factory.export.gltf_writer import validate_gltf
from creature_factory.mesh import Mesh, boundary_and_nonmanifold, degenerate_quads, signed_volume, triangle_area
from creature_factory.math3d import v3
from creature_factory.rig import BIPED_REQUIRED, QUADRUPED_REQUIRED, validate_hierarchy
from creature_factory.rig.skeleton import Skeleton, skin_vertex

CHECKS = {
    "non_manifold": (12, True, "mesh_validate"),
    "inverted_normals": (8, True, "mesh_validate"),
    "degenerate_faces": (10, True, "mesh_validate"),
    "uv_errors": (8, True, "uv"),
    "missing_textures": (8, True, "materials"),
    "scale_orientation": (6, True, "generate_3d"),
    "bone_hierarchy": (10, True, "rig"),
    "skin_weights": (10, True, "rig"),
    "joint_deformation": (8, True, "rig"),
    "foot_slide": (8, True, "animate"),
    "mesh_penetration": (6, True, "generate_3d"),
    "export_integrity": (8, True, "export"),
    "triangle_budget": (8, True, "retopo"),
    "animation_set": (8, True, "animate"),
}


def _result(name: str, passed: bool, detail: str) -> dict:
    weight, critical, loop_to = CHECKS[name]
    return {
        "name": name,
        "passed": passed,
        "critical": critical,
        "weight": weight,
        "loop_to": loop_to if not passed else None,
        "detail": detail,
    }


def _segment_hits(origin: np.ndarray, dest: np.ndarray, triangles: np.ndarray) -> bool:
    direction = dest - origin
    for tri in triangles:
        edge1 = tri[1] - tri[0]
        edge2 = tri[2] - tri[0]
        pvec = np.cross(direction, edge2)
        det = float(np.dot(edge1, pvec))
        if abs(det) < 1e-8:
            continue
        inv = 1.0 / det
        tvec = origin - tri[0]
        u_coord = float(np.dot(tvec, pvec)) * inv
        if u_coord < 0.0 or u_coord > 1.0:
            continue
        qvec = np.cross(tvec, edge1)
        v_coord = float(np.dot(direction, qvec)) * inv
        if v_coord < 0.0 or u_coord + v_coord > 1.0:
            continue
        t_hit = float(np.dot(edge2, qvec)) * inv
        if 0.04 < t_hit < 0.96:
            return True
    return False


def _is_biped(skeleton: Skeleton) -> bool:
    return "thigh_l" in skeleton.parent and "thigh_fl" not in skeleton.parent


def _penetration(mesh: Mesh, skeleton: Skeleton) -> str | None:
    positions = mesh.positions
    body_tris = []
    for quad, part in zip(mesh.quads, mesh.parts):
        if part.startswith(("leg_", "arm_", "horn_", "spike_", "sword", "cape", "boot", "hand_", "pants", "pouch")):
            continue
        a, b, c, d = quad
        body_tris.append([positions[a], positions[b], positions[c]])
        body_tris.append([positions[a], positions[c], positions[d]])
    if not body_tris:
        return "no body triangles to test"
    triangles = np.array(body_tris, dtype=np.float64)
    if _is_biped(skeleton):
        chains = (("l", "calf_l", "foot_l", "toe_l"), ("r", "calf_r", "foot_r", "toe_r"))
        for side, knee_name, ankle_name, toe_name in chains:
            knee = skeleton.rest_world[knee_name]
            ankle = skeleton.rest_world[ankle_name]
            toe = skeleton.rest_world[toe_name]
            for start, end in ((knee, ankle), (ankle, toe)):
                if _segment_hits(start, end, triangles):
                    return f"{side} limb segment intersects the body shell"
        return None
    for side in ("fl", "fr", "hl", "hr"):
        knee = skeleton.rest_world[f"shin_{side}"]
        ankle = skeleton.rest_world[f"foot_{side}"]
        toe = skeleton.rest_world[f"toe_{side}"]
        for start, end in ((knee, ankle), (ankle, toe)):
            if _segment_hits(start, end, triangles):
                return f"{side} limb segment intersects the body shell"
    return None


def _planted_error(skeleton: Skeleton, clip: Clip) -> float:
    sides = ("l", "r") if _is_biped(skeleton) else ("fl", "fr", "hl", "hr")
    worst = 0.0
    for side in sides:
        flags = clip.contacts[f"foot_{side}"]
        for frame in range(len(flags) - 1):
            if not (flags[frame] and flags[frame + 1]):
                continue
            pose = {bone: np.array(keys[frame], dtype=np.float64) for bone, keys in clip.rotations.items()}
            pose_n = {bone: np.array(keys[frame + 1], dtype=np.float64) for bone, keys in clip.rotations.items()}
            pos, _r, _m = skeleton.forward(pose, np.array(clip.root_translation[frame], dtype=np.float64))
            pos_n, _r2, _m2 = skeleton.forward(pose_n, np.array(clip.root_translation[frame + 1], dtype=np.float64))
            delta = pos_n[f"foot_{side}"] - pos[f"foot_{side}"]
            worst = max(worst, abs(float(delta[0])), abs(float(delta[1])))
            if float(delta[2]) > 0.01:
                worst = max(worst, float(delta[2]))
    return worst


def evaluate_creature(
    *,
    lod0: Mesh,
    control: Mesh,
    skeleton: Skeleton,
    clips: dict[str, Clip],
    profile: dict,
    texture_paths: dict[str, Path],
    gltf_path: Path,
) -> dict:
    checks = []
    boundary, nonmanifold = boundary_and_nonmanifold(lod0)
    checks.append(
        _result(
            "non_manifold",
            not boundary and not nonmanifold,
            f"boundary edges {len(boundary)}, non-manifold edges {len(nonmanifold)}",
        )
    )
    volume = signed_volume(lod0)
    checks.append(_result("inverted_normals", volume > 0.0, f"signed volume {volume:.5f}"))
    bad_faces = degenerate_quads(lod0)
    checks.append(_result("degenerate_faces", not bad_faces, f"degenerate quads {len(bad_faces)}"))

    uv_bad = 0
    for face, quad in zip(lod0.uvs, lod0.quads):
        for u_coord, v_coord in face:
            if not (0.0 <= u_coord <= 1.0 and 0.0 <= v_coord <= 1.0):
                uv_bad += 1
        pa, pb, pc, pd = (lod0.positions[i] for i in quad)
        del pa, pb, pc, pd
        uv_area = triangle_area(v3(face[0][0], face[0][1], 0), v3(face[1][0], face[1][1], 0), v3(face[2][0], face[2][1], 0))
        uv_area += triangle_area(v3(face[0][0], face[0][1], 0), v3(face[2][0], face[2][1], 0), v3(face[3][0], face[3][1], 0))
        if uv_area < 1e-8:
            uv_bad += 1
    checks.append(_result("uv_errors", uv_bad == 0, f"uv issues {uv_bad}"))

    texture_problems = []
    expected = int(profile["texture_size"])
    for name, path in texture_paths.items():
        if not path.is_file():
            texture_problems.append(f"{name} missing")
            continue
        with Image.open(path) as image:
            if image.size != (expected, expected):
                texture_problems.append(f"{name} is {image.size}, expected {expected}")
    checks.append(_result("missing_textures", not texture_problems, "; ".join(texture_problems) or "PBR textures present"))

    ys = [float(point[1]) for point in lod0.positions]
    zs = [float(point[2]) for point in lod0.positions]
    biped = _is_biped(skeleton)
    if biped:
        oriented = (
            min(ys) <= 0.02
            and 1.2 <= max(ys) <= 2.4
            and float(skeleton.rest_world["head"][1]) > float(skeleton.rest_world["pelvis"][1])
            and float(skeleton.rest_world["hand_r"][0]) > 0.05
            and float(skeleton.rest_world["hand_l"][0]) < -0.05
        )
        orient_detail = f"height {max(ys):.2f} m, minY {min(ys):.3f}, biped upright"
    else:
        oriented = (
            min(ys) <= 0.02
            and 0.5 <= max(ys) <= 3.5
            and max(zs) - min(zs) > 1.0
            and float(skeleton.rest_world["head"][2]) > float(skeleton.rest_world["pelvis"][2])
            and float(skeleton.rest_world["tail_04"][2]) < float(skeleton.rest_world["pelvis"][2])
        )
        orient_detail = f"height {max(ys):.2f} m, length {max(zs) - min(zs):.2f} m, minY {min(ys):.3f}, facing +Z"
    checks.append(_result("scale_orientation", oriented, orient_detail))

    hierarchy_errors = validate_hierarchy([(name, skeleton.parent[name]) for name in skeleton.names])
    required_bones = BIPED_REQUIRED if biped else QUADRUPED_REQUIRED
    missing = [name for name in required_bones if name not in skeleton.parent]
    checks.append(
        _result(
            "bone_hierarchy",
            not hierarchy_errors and not missing,
            "; ".join(hierarchy_errors + ([f"missing {missing}"] if missing else [])).strip("; ")
            or ("biped hierarchy ok" if biped else "quadruped hierarchy ok"),
        )
    )

    weight_errors = []
    used = set()
    for weights in lod0.weights:
        total = sum(weights.values())
        if abs(total - 1.0) > 1e-3 or any(value < 0 for value in weights.values()) or len(weights) > 4:
            weight_errors.append("bad influence")
            break
        for bone in weights:
            if bone not in skeleton.parent:
                weight_errors.append(f"unknown bone {bone}")
                break
            used.add(bone)
    weight_bones = (
        ("pelvis", "head", "thigh_l", "calf_l", "foot_l", "thigh_r", "upperarm_r", "cape_01")
        if biped
        else ("pelvis", "head", "thigh_fl", "shin_fl", "foot_fl", "thigh_hl", "tail_01")
    )
    for required in weight_bones:
        if required not in used:
            weight_errors.append(f"{required} has no weights")
    checks.append(_result("skin_weights", not weight_errors, "; ".join(weight_errors) or "weights normalized"))

    inverse = skeleton.inverse_bind()
    _pos, _rot, rest_mats = skeleton.forward({})
    shin_name = "calf_l" if biped else "shin_fl"
    best = max(range(len(lod0.weights)), key=lambda index: lod0.weights[index].get(shin_name, 0.0))
    shin_weight = lod0.weights[best].get(shin_name, 0.0)
    head_index = max(range(len(lod0.weights)), key=lambda index: lod0.weights[index].get("head", 0.0))
    deform_ok = shin_weight > 0.45
    detail = f"{shin_name} influence {shin_weight:.2f}"
    if deform_ok:
        rest_point = skin_vertex(lod0.positions[best], lod0.weights[best], rest_mats, inverse)
        bent = {shin_name: np.array([0.0, 0.0, np.sin(0.2), np.cos(0.2)])}
        _p, _r, bent_mats = skeleton.forward(bent)
        moved = skin_vertex(lod0.positions[best], lod0.weights[best], bent_mats, inverse)
        head_rest = skin_vertex(lod0.positions[head_index], lod0.weights[head_index], rest_mats, inverse)
        head_moved = skin_vertex(lod0.positions[head_index], lod0.weights[head_index], bent_mats, inverse)
        travel = float(np.linalg.norm(moved - rest_point))
        head_travel = float(np.linalg.norm(head_moved - head_rest))
        deform_ok = travel > 0.004 and head_travel < travel * 0.35 and np.allclose(rest_point, lod0.positions[best], atol=1e-3)
        detail = f"{shin_name} moved {travel:.4f} m, head moved {head_travel:.4f} m"
    checks.append(_result("joint_deformation", deform_ok, detail))

    slide_notes = []
    slide_ok = True
    for name in ("walk", "run"):
        error = _planted_error(skeleton, clips[name])
        slide_notes.append(f"{name} {error:.4f}")
        if error > 0.02:
            slide_ok = False
    checks.append(_result("foot_slide", slide_ok, ", ".join(slide_notes)))

    hit = _penetration(control, skeleton)
    checks.append(_result("mesh_penetration", hit is None, hit or "leg segments stay outside the body shell"))

    export_errors = validate_gltf(gltf_path)
    checks.append(_result("export_integrity", not export_errors, "; ".join(export_errors) or "glTF buffer, accessors, and textures resolve"))

    tri_min = int(profile["tri_min"])
    tri_max = int(profile["tri_max"])
    tris = lod0.triangle_count
    checks.append(_result("triangle_budget", tri_min <= tris <= tri_max, f"LOD0 {tris} triangles, target {tri_min}-{tri_max}"))

    names = list(clips)
    required_clips = HUMANOID_CLIP_NAMES if biped else CLIP_NAMES
    anim_ok = len(names) >= int(profile["min_animations"]) and all(name in clips for name in required_clips)
    checks.append(_result("animation_set", anim_ok, "clips: " + ", ".join(names)))

    earned = sum(check["weight"] for check in checks if check["passed"])
    total = sum(check["weight"] for check in checks)
    score = round(100.0 * earned / total, 2)
    critical_failed = [check for check in checks if check["critical"] and not check["passed"]]
    decision = "accept" if not critical_failed and score >= 85 else "reject"
    loop_to = critical_failed[0]["loop_to"] if critical_failed else None
    return {
        "score": score,
        "decision": decision,
        "loop_to": loop_to,
        "profile": profile.get("name"),
        "checks": checks,
        "generator": "offline_mvp",
    }
