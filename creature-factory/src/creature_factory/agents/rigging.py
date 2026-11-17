"""Rigging agent. Custom quadruped or biped template, not Rigify."""

from __future__ import annotations

import numpy as np

from creature_factory.pipeline import AgentResult, PipelineContext, dump_json
from creature_factory.rig import BIPED_BONES, QUADRUPED_BONES, bones_as_json
from creature_factory.rig.skeleton import build_biped_skeleton, build_skeleton


def run(ctx: PipelineContext) -> AgentResult:
    generated = ctx.generated
    if ctx.spec.archetype == "biped":
        skeleton = build_biped_skeleton(generated.landmarks, generated.scale)
        bones = BIPED_BONES
        label = "biped"
    else:
        skeleton = build_skeleton(generated.landmarks, generated.scale)
        bones = QUADRUPED_BONES
        label = "quadruped"
    ctx.skeleton = skeleton
    payload = {
        "archetype": label,
        "status": "generated",
        "method": "custom_template_auto_placement",
        "rigify": False,
        "bones": bones_as_json(bones),
        "rest_world": {name: [round(float(v), 6) for v in point] for name, point in skeleton.rest_world.items()},
        "local_translation": {
            name: [round(float(v), 6) for v in point] for name, point in skeleton.local_translation.items()
        },
    }
    dump_json(ctx.root / "rig" / "skeleton.json", payload)
    lod0 = ctx.lods["lod0"]
    names = skeleton.names
    index = {name: i for i, name in enumerate(names)}
    joints = np.zeros((len(lod0.weights), 4), dtype=np.int16)
    weights = np.zeros((len(lod0.weights), 4), dtype=np.float32)
    for row, influence in enumerate(lod0.weights):
        pairs = sorted(influence.items(), key=lambda item: item[1], reverse=True)[:4]
        for slot, (bone, value) in enumerate(pairs):
            joints[row, slot] = index[bone]
            weights[row, slot] = value
    np.savez_compressed(ctx.root / "rig" / "weights.npz", joints=joints, weights=weights, names=np.array(names))
    summary = {
        "vertices": len(lod0.weights),
        "influences_per_vertex": 4,
        "bones": names,
        "storage": "rig/weights.npz",
        "note": "Full weights are also stored on the glTF primitive as JOINTS_0 and WEIGHTS_0.",
    }
    dump_json(ctx.root / "rig" / "weights_summary.json", summary)
    return AgentResult(f"placed {len(names)} {label} bones and wrote skin weights")
