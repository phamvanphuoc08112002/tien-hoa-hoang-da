"""Animation agent. Seven procedural clips."""

from __future__ import annotations

from creature_factory.anim.clips import CLIP_NAMES, build_clips
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json


def run(ctx: PipelineContext) -> AgentResult:
    clips = build_clips(ctx.skeleton)
    missing = [name for name in CLIP_NAMES if name not in clips]
    if missing:
        raise RuntimeError(f"animation set is missing {missing}")
    ctx.clips = clips
    for name, clip in clips.items():
        dump_json(ctx.root / "animations" / f"{name}.json", clip.to_json())
    dump_json(
        ctx.root / "animations" / "manifest.json",
        {"clips": list(CLIP_NAMES), "source": "offline_mvp procedural curves", "count": len(CLIP_NAMES)},
    )
    return AgentResult("wrote idle, walk, run, jump, attack, hit, and death")
