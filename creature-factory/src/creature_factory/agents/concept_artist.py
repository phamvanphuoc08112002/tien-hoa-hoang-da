"""Concept artist. Prefers ComfyUI when the server is up; otherwise Pillow."""

from __future__ import annotations

from PIL import Image, ImageDraw

from creature_factory.adapters import AdapterUnavailable, ComfyUIAdapter, probe_environment
from creature_factory.mesh.quadruped import _scaled_stations
from creature_factory.pipeline import AgentResult, PipelineContext, dump_json


def _by_name(report: list[dict]) -> dict:
    return {item["name"]: item for item in report}


def _hex(color: str) -> tuple[int, int, int]:
    text = color.lstrip("#")
    return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)


def _draw_quadruped(draw: ImageDraw.ImageDraw, ctx: PipelineContext) -> None:
    scale = float(ctx.spec.proportions.get("body_scale", 1.0) or 1.0)
    stations = _scaled_stations(scale)
    primary = _hex(ctx.spec.palette[0])

    def project(point):
        x = 140 + (float(point[2]) + 1.3) * 280
        y = 430 - float(point[1]) * 180
        return x, y

    centers = [project(station["center"]) for station in stations]
    for start, end, station in zip(centers, centers[1:], stations):
        radius = max(4, int(station["ry"] * 170))
        draw.line((start, end), fill=primary, width=radius)
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


def _draw_hero(draw: ImageDraw.ImageDraw, ctx: PipelineContext) -> None:
    blue = _hex(ctx.spec.palette[0])
    skin = _hex(ctx.spec.palette[1] if len(ctx.spec.palette) > 1 else "#F2C7A4")
    leather = _hex(ctx.spec.palette[2] if len(ctx.spec.palette) > 2 else "#6B3E2E")
    cx = 480
    ground = 460
    head = (cx, 120)
    draw.ellipse((head[0] - 34, head[1] - 40, head[0] + 34, head[1] + 36), fill=skin, outline=(40, 30, 24), width=2)
    for spike in ((-18, -28), (0, -40), (18, -24), (-8, -18), (10, -16)):
        draw.polygon(
            [(head[0] + spike[0], head[1] + spike[1]), (head[0] + spike[0] - 8, head[1] + 4), (head[0] + spike[0] + 8, head[1] + 4)],
            fill=leather,
        )
    draw.ellipse((head[0] - 12, head[1] - 4, head[0] - 4, head[1] + 8), fill=(30, 20, 16))
    draw.ellipse((head[0] + 4, head[1] - 4, head[0] + 12, head[1] + 8), fill=(30, 20, 16))
    draw.rectangle((cx - 48, 160, cx + 48, 280), fill=blue, outline=(30, 40, 80), width=2)
    draw.rectangle((cx - 40, 280, cx + 40, 330), fill=blue)
    draw.polygon([(cx - 70, 165), (cx - 48, 170), (cx - 55, 360), (cx - 95, 350)], fill=blue)
    draw.polygon([(cx + 70, 165), (cx + 48, 170), (cx + 55, 360), (cx + 95, 350)], fill=blue)
    draw.line(((cx - 48, 175), (cx - 120, 250), (cx - 140, 320)), fill=skin, width=14)
    draw.line(((cx + 48, 175), (cx + 125, 245), (cx + 155, 200)), fill=skin, width=14)
    draw.line(((cx + 155, 200), (cx + 210, 140)), fill=(120, 200, 255), width=10)
    draw.ellipse((cx + 200, 120, cx + 230, 150), outline=(80, 160, 255), width=3)
    draw.line(((cx - 22, 330), (cx - 35, 400), (cx - 30, ground)), fill=leather, width=16)
    draw.line(((cx + 22, 330), (cx + 35, 400), (cx + 30, ground)), fill=leather, width=16)
    draw.rectangle((cx - 45, 445, cx - 10, 458), fill=leather)
    draw.rectangle((cx + 10, 445, cx + 45, 458), fill=leather)
    draw.text((40, 500), "Type 1 hero · Pillow fallback · start ComfyUI for sheet-quality concept", fill=(243, 226, 196))


def _pillow_concept(ctx: PipelineContext, path) -> None:
    image = Image.new("RGB", (960, 540), (28, 25, 22))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 960, 70), fill=(42, 32, 24))
    draw.text((24, 18), f"{ctx.spec.species}  ·  {ctx.spec.archetype}  ·  procedural concept", fill=(243, 226, 196))
    draw.text((24, 42), "ComfyUI was not called", fill=(227, 160, 8))
    if ctx.spec.archetype == "biped":
        _draw_hero(draw, ctx)
    else:
        _draw_quadruped(draw, ctx)
    draw.line((40, 460, 920, 460), fill=(90, 78, 64), width=2)
    image.save(path)


def run(ctx: PipelineContext) -> AgentResult:
    path = ctx.root / "concept" / "concept.png"
    tools = _by_name(ctx.tool_report or probe_environment(ctx.settings))
    workflows_dir = ctx.settings.project_root / "workflows"
    used_comfy = False
    backend = "procedural_pillow"
    detail = "ComfyUI was not called"
    try:
        adapter = ComfyUIAdapter(ctx.settings.comfyui_url, workflows_dir=workflows_dir)
        adapter.render(ctx.spec.prompt, path, seed=hash(ctx.spec.creature_id or ctx.spec.species) % 1_000_000)
        used_comfy = True
        backend = "comfyui"
        detail = f"ComfyUI rendered concept via {workflows_dir / 'concept_hero_api.json'}"
    except AdapterUnavailable as exc:
        _pillow_concept(ctx, path)
        detail = str(exc)
    note = {
        "backend": backend,
        "comfyui_used": used_comfy,
        "comfyui": tools.get("comfyui"),
        "file": "concept/concept.png",
        "prompt": ctx.spec.prompt,
        "asset_type": "hero_type1" if ctx.spec.archetype == "biped" else "creature",
        "detail": detail,
    }
    dump_json(ctx.root / "concept" / "concept.json", note)
    ctx.notes["concept"] = note
    if used_comfy:
        return AgentResult("ComfyUI concept saved")
    return AgentResult(f"procedural concept saved; {detail}")
