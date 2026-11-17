"""Software preview of the control mesh. No Unreal or Blender viewport is involved."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from creature_factory.mesh import Mesh, vertex_normals


def _color(part: str) -> np.ndarray:
    if part == "eye_white":
        return np.array([245, 245, 248], dtype=np.float64)
    if part == "eye_pupil":
        return np.array([18, 14, 12], dtype=np.float64)
    if part.startswith("eye"):
        return np.array([92, 58, 36], dtype=np.float64)
    if part.startswith("horn"):
        return np.array([232, 196, 120], dtype=np.float64)
    if part.startswith("spike"):
        return np.array([74, 34, 30], dtype=np.float64)
    if part == "belly":
        return np.array([236, 214, 184], dtype=np.float64)
    if part.startswith("leg"):
        return np.array([96, 50, 38], dtype=np.float64)
    if part in {"head", "snout", "skin"}:
        return np.array([242, 199, 164], dtype=np.float64)
    if part == "tail":
        return np.array([122, 56, 40], dtype=np.float64)
    if part in {"tunic", "armor", "cape", "vest"}:
        return np.array([59, 111, 219], dtype=np.float64)
    if part == "shirt":
        return np.array([244, 246, 250], dtype=np.float64)
    if part == "pants":
        return np.array([92, 64, 48], dtype=np.float64)
    if part in {"belt", "pouch"}:
        return np.array([110, 70, 42], dtype=np.float64)
    if part == "hair":
        return np.array([92, 54, 36], dtype=np.float64)
    if part == "boot":
        return np.array([107, 62, 46], dtype=np.float64)
    if part == "sword_hilt" or part == "gem":
        return np.array([212, 168, 64], dtype=np.float64)
    if part.startswith("sword"):
        return np.array([120, 210, 255], dtype=np.float64)
    if part.startswith(("arm_", "hand_")):
        return np.array([232, 188, 150], dtype=np.float64)
    return np.array([156, 74, 48], dtype=np.float64)


def render_preview(mesh: Mesh, path: Path, width: int = 520, height: int = 320) -> None:
    positions = np.stack(mesh.positions)
    normals = np.stack(vertex_normals(mesh))
    screen_x = positions[:, 2] * 0.92 + positions[:, 0] * 0.62
    screen_y = positions[:, 1]
    depth = positions[:, 0] * 0.8 - positions[:, 2] * 0.15
    span_x = max(float(screen_x.max() - screen_x.min()), 1e-4)
    span_y = max(float(screen_y.max() - screen_y.min()), 1e-4)
    scale = min(width * 0.88 / span_x, height * 0.78 / span_y)
    origin_x = (width - span_x * scale) * 0.5 - float(screen_x.min()) * scale
    origin_y = height * 0.9 - float(screen_y.min()) * scale
    light = np.array([-0.3, 0.82, 0.4], dtype=np.float64)
    light /= np.linalg.norm(light)
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:] = (28, 25, 22)
    zbuffer = np.full((height, width), np.inf, dtype=np.float64)

    def project(index: int):
        sx = float(screen_x[index]) * scale + origin_x
        sy = origin_y - float(screen_y[index]) * scale
        return sx, sy, float(depth[index])

    for face_index, quad in enumerate(mesh.quads):
        tint = _color(mesh.parts[face_index])
        for tri in ((0, 1, 2), (0, 2, 3)):
            ids = [quad[corner] for corner in tri]
            projected = [project(index) for index in ids]
            xs = [p[0] for p in projected]
            ys = [p[1] for p in projected]
            min_x = max(int(min(xs)), 0)
            max_x = min(int(max(xs)) + 1, width - 1)
            min_y = max(int(min(ys)), 0)
            max_y = min(int(max(ys)) + 1, height - 1)
            if min_x >= max_x or min_y >= max_y:
                continue
            x0, y0, z0 = projected[0]
            x1, y1, z1 = projected[1]
            x2, y2, z2 = projected[2]
            denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(denom) < 1e-8:
                continue
            normal = normals[ids[0]] + normals[ids[1]] + normals[ids[2]]
            length = float(np.linalg.norm(normal))
            shade = 0.28 if length < 1e-8 else max(0.28, float(np.dot(normal / length, light)))
            rgb = np.clip(tint * shade, 0, 255)
            for py in range(min_y, max_y + 1):
                for px in range(min_x, max_x + 1):
                    w0 = ((y1 - y2) * (px + 0.5 - x2) + (x2 - x1) * (py + 0.5 - y2)) / denom
                    w1 = ((y2 - y0) * (px + 0.5 - x2) + (x0 - x2) * (py + 0.5 - y2)) / denom
                    w2 = 1.0 - w0 - w1
                    if w0 < 0 or w1 < 0 or w2 < 0:
                        continue
                    z_value = w0 * z0 + w1 * z1 + w2 * z2
                    if z_value < zbuffer[py, px]:
                        zbuffer[py, px] = z_value
                        image[py, px] = rgb
    picture = Image.fromarray(image, "RGB")
    draw = ImageDraw.Draw(picture)
    draw.text((12, 8), "offline MVP control mesh", fill=(232, 214, 180))
    path.parent.mkdir(parents=True, exist_ok=True)
    picture.save(path)
