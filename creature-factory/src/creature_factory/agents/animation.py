"""Animation agent. Procedural clips for quadruped or humanoid hero."""

from __future__ import annotations

from creature_factory.anim.clips import CLIP_NAMES, build_clips
from creature_factory.anim.humanoid_clips import HUMANOID_CLIP_NAMES, build_humanoid_clips
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json


def run(ctx: PipelineContext) -> AgentResult:
    if ctx.spec.archetype == "biped":
        clips = build_humanoid_clips(ctx.skeleton)
        required = HUMANOID_CLIP_NAMES
        label = "idle, walk, run, attack, skill, hurt, and die"
    else:
        clips = build_clips(ctx.skeleton)
        required = CLIP_NAMES
        label = "idle, walk, run, jump, attack, hit, and death"
    missing = [name for name in required if name not in clips]
    if missing:
        raise RuntimeError(f"animation set is missing {missing}")
    ctx.clips = clips
    for name, clip in clips.items():
        dump_json(ctx.root / "animations" / f"{name}.json", clip.to_json())
    dump_json(
        ctx.root / "animations" / "manifest.json",
        {"clips": list(required), "source": "offline_mvp procedural curves", "count": len(required)},
    )
    return AgentResult(f"wrote {label}")
