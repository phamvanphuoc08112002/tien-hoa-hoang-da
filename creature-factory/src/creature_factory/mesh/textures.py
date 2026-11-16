"""Procedural PBR images. These are not baked from TRELLIS or a DCC tool."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image


def _hex(color: str) -> np.ndarray:
    text = color.lstrip("#")
    return np.array([int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)], dtype=np.float64)


def _noise(size: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    field = np.zeros((size, size), dtype=np.float64)
    amplitude = 1.0
    total = 0.0
    for resolution in (4, 8, 16, 32, 64):
        if size % resolution != 0:
            continue
        grid = rng.random((resolution, resolution))
        block = size // resolution
        upsampled = np.repeat(np.repeat(grid, block, axis=0), block, axis=1)
        field += upsampled * amplitude
        total += amplitude
        amplitude *= 0.5
    return field / total


def write_pbr_textures(directory: Path, palette: list[str], material: str, element: str, size: int, seed: int = 7) -> dict[str, str]:
    directory.mkdir(parents=True, exist_ok=True)
    colors = [_hex(color) for color in palette]
    while len(colors) < 4:
        colors.append(colors[-1])
    noise = _noise(size, seed)
    fine = _noise(size, seed + 19)
    yy, xx = np.mgrid[0:size, 0:size]
    stripes = 0.5 + 0.5 * np.sin(yy / max(size, 1) * np.pi * 10.0)
    mix = np.clip(noise * 0.75 + stripes * 0.25, 0.0, 1.0)
    base = colors[0] * (1.0 - mix)[..., None] + colors[1] * mix[..., None]
    belly = np.clip((0.5 - np.abs(xx / size - 0.5)) * 2.2, 0.0, 1.0)
    base = base * (1.0 - 0.35 * belly[..., None]) + colors[3] * (0.35 * belly[..., None])
    tints = {
        "fire": (1.08, 0.9, 0.78),
        "water": (0.82, 0.95, 1.12),
        "nature": (0.86, 1.08, 0.86),
        "storm": (0.88, 0.9, 1.12),
        "earth": (1.02, 0.94, 0.82),
    }
    tint = np.array(tints.get(element, (1.0, 1.0, 1.0)))
    base = np.clip(base * tint, 0, 255).astype(np.uint8)

    rough_value = {"scales": 0.46, "skin": 0.58, "fur": 0.84, "hide": 0.62, "metal": 0.28, "chitin": 0.36}.get(material, 0.55)
    metal_value = 0.82 if material == "metal" else 0.05
    roughness = np.clip(rough_value + (fine - 0.5) * 0.25, 0.08, 0.95)
    metallic = np.full((size, size), metal_value)
    mr = np.zeros((size, size, 3), dtype=np.uint8)
    mr[..., 0] = 255
    mr[..., 1] = (roughness * 255).astype(np.uint8)
    mr[..., 2] = (metallic * 255).astype(np.uint8)

    strength = 1.6 if material == "scales" else 0.8
    dx = np.roll(fine, -1, axis=1) - np.roll(fine, 1, axis=1)
    dy = np.roll(fine, -1, axis=0) - np.roll(fine, 1, axis=0)
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(fine)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([(nx / length) * 0.5 + 0.5, (ny / length) * 0.5 + 0.5, (nz / length) * 0.5 + 0.5], axis=-1)
    normal = (np.clip(normal, 0, 1) * 255).astype(np.uint8)

    paths = {
        "baseColor": directory / "basecolor.png",
        "metallicRoughness": directory / "metallic_roughness.png",
        "normal": directory / "normal.png",
    }
    Image.fromarray(base, "RGB").save(paths["baseColor"])
    Image.fromarray(mr, "RGB").save(paths["metallicRoughness"])
    Image.fromarray(normal, "RGB").save(paths["normal"])
    return {name: str(path.name) for name, path in paths.items()}
