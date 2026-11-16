"""Concept artist. Pillow drawing only; ComfyUI is not called."""

from __future__ import annotations

from PIL import Image, ImageDraw

from creature_factory.adapters import probe_environment
from creature_factory.mesh.quadruped import _scaled_stations
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json


def _by_name(report: list[dict]) -> dict:
    return {item["name"]: item for item in report}


def run(ctx: PipelineContext) -> AgentResult:
    scale = float(ctx.spec.proportions.get("body_scale", 1.0) or 1.0)
    stations = _scaled_stations(scale)
    image = Image.new("RGB", (960, 540), (28, 25, 22))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 960, 70), fill=(42, 32, 24))
    draw.text((24, 18), f"{ctx.spec.species}  ·  {ctx.spec.archetype}  ·  procedural concept", fill=(243, 226, 196))
    draw.text((24, 42), "ComfyUI was not called", fill=(227, 160, 8))

    def project(point):
        x = 140 + (float(point[2]) + 1.3) * 280
        y = 430 - float(point[1]) * 180
        return x, y

    centers = [project(station["center"]) for station in stations]
    for start, end, station in zip(centers, centers[1:], stations):
        radius = max(4, int(station["ry"] * 170))
        draw.line((start, end), fill=tuple(int(ctx.spec.palette[0].lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)), width=radius)
    for center, station in zip(centers, stations):
        radius = max(6, int(station["ry"] * 190))
        draw.ellipse((center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius), outline=(244, 225, 193))
    for anchor in (6, 9):
        hip = centers[anchor]
        for side in (-1, 1):
            knee = (hip[0] + 18, hip[1] + 70)
            foot = (hip[0] + side * 36, 455)
            draw.line((hip, knee, foot), fill=(227, 160, 8), width=5)
    if ctx.spec.horns:
        head = centers[14]
        draw.line((head, (head[0] - 10, head[1] - 36)), fill=(227, 160, 8), width=4)
        draw.line((head, (head[0] + 16, head[1] - 32)), fill=(227, 160, 8), width=4)
    draw.line((40, 460, 920, 460), fill=(90, 78, 64), width=2)
    path = ctx.root / "concept" / "concept.png"
    image.save(path)
    tools = _by_name(ctx.tool_report or probe_environment(ctx.settings))
    note = {
        "backend": "procedural_pillow",
        "comfyui_used": False,
        "comfyui": tools.get("comfyui"),
        "file": "concept/concept.png",
        "prompt": ctx.spec.prompt,
    }
    dump_json(ctx.root / "concept" / "concept.json", note)
    ctx.notes["concept"] = note
    return AgentResult("procedural concept saved; ComfyUI was not called")
