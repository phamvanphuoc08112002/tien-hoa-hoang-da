"""Procedural stylized fantasy hero — closer to the RPG design sheet, not voxel blocks."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from creature_factory.math3d import lerp, normalize, v3
from creature_factory.mesh import Mesh, boundary_and_nonmanifold, fix_winding
from creature_factory.specs import CreatureSpec

SIDES = 12


@dataclass
class GeneratedHumanoid:
    mesh: Mesh
    proxy: Mesh
    landmarks: dict[str, np.ndarray]
    scale: float
    notes: list[str] = field(default_factory=list)


def _axis(spec: CreatureSpec, name: str, default: float, low: float, high: float) -> float:
    value = float(spec.proportions.get(name, default) or default)
    return min(high, max(low, value))


def _cell_uvs(rect, index: int, count: int):
    u0, v0, u1, v1 = rect
    count = max(count, 1)
    width = (u1 - u0) / count
    pad = min(0.0012, width * 0.08)
    left = u0 + index * width + pad
    right = u0 + (index + 1) * width - pad
    bottom = v0 + pad
    top = v1 - pad
    return [(left, bottom), (right, bottom), (right, top), (left, top)]


def _cap_loop(mesh: Mesh, ring: list[int], inside: np.ndarray, part: str, uv_rect) -> None:
    loop = list(ring)
    quads = []
    while len(loop) > 4:
        quads.append((loop[0], loop[1], loop[2], loop[-1]))
        loop = loop[2:]
    if len(loop) != 4:
        raise RuntimeError(f"cap loop ended at {len(loop)}")
    quads.append(tuple(loop))
    for index, quad in enumerate(quads):
        mesh.add_quad(quad, _cell_uvs(uv_rect, index, len(quads)), part, inside)


def _add_ellipsoid(
    mesh: Mesh,
    center: np.ndarray,
    radii: np.ndarray,
    weights: dict[str, float],
    part: str,
    uv_rect,
    stacks: int = 6,
    slices: int = SIDES,
) -> None:
    # Keep rings away from the exact poles so every ring has area, then cap both ends.
    rx, ry, rz = (float(v) for v in radii)
    rings = []
    for stack in range(stacks):
        v_frac = (stack + 0.5) / stacks
        phi = math.pi * (v_frac - 0.5) * 0.92
        cy = math.sin(phi)
        ring_r = max(math.cos(phi), 0.12)
        ring = []
        for sector in range(slices):
            theta = 2.0 * math.pi * sector / slices
            position = center + v3(math.cos(theta) * ring_r * rx, cy * ry, math.sin(theta) * ring_r * rz)
            ring.append(mesh.add_vertex(position, weights))
        rings.append(ring)
    for stack in range(stacks - 1):
        inside = center + v3(0, ((stack + 1.0) / stacks - 0.5) * ry, 0)
        for sector in range(slices):
            nxt = (sector + 1) % slices
            mesh.add_quad(
                (rings[stack][sector], rings[stack][nxt], rings[stack + 1][nxt], rings[stack + 1][sector]),
                _cell_uvs(uv_rect, sector + stack * slices, slices * max(stacks - 1, 1)),
                part,
                inside,
            )
    _cap_loop(mesh, list(reversed(rings[0])), center + v3(0, -ry, 0), part, uv_rect)
    _cap_loop(mesh, rings[-1], center + v3(0, ry, 0), part, uv_rect)


def _add_tube(
    mesh: Mesh,
    path: list[np.ndarray],
    radii: list[float],
    weight_list: list[dict[str, float]],
    part: str,
    uv_rect,
    oval: tuple[float, float] = (1.0, 1.0),
) -> None:
    if len(path) < 2:
        return
    rings = []
    for center, radius, weights in zip(path, radii, weight_list):
        index = len(rings)
        if index == 0:
            tangent = normalize(path[1] - path[0], v3(0, 1, 0))
        elif index == len(path) - 1:
            tangent = normalize(path[-1] - path[-2], v3(0, 1, 0))
        else:
            tangent = normalize(path[index + 1] - path[index - 1], v3(0, 1, 0))
        helper = v3(0, 1, 0) if abs(float(tangent[1])) < 0.92 else v3(1, 0, 0)
        right = normalize(np.cross(tangent, helper), v3(1, 0, 0))
        up = normalize(np.cross(right, tangent), v3(0, 1, 0))
        ring = []
        for sector in range(SIDES):
            angle = 2.0 * math.pi * sector / SIDES
            offset = right * math.cos(angle) * radius * oval[0] + up * math.sin(angle) * radius * oval[1]
            ring.append(mesh.add_vertex(center + offset, weights))
        rings.append(ring)
    steps = len(rings) - 1
    for step in range(steps):
        inside = lerp(path[step], path[step + 1], 0.5)
        for sector in range(SIDES):
            nxt = (sector + 1) % SIDES
            mesh.add_quad(
                (rings[step][sector], rings[step][nxt], rings[step + 1][nxt], rings[step + 1][sector]),
                _cell_uvs(uv_rect, sector + step * SIDES, SIDES * steps),
                part,
                inside,
            )
    _cap_loop(mesh, list(reversed(rings[0])), path[0], part, uv_rect)
    _cap_loop(mesh, rings[-1], path[-1], part, uv_rect)


def _add_blade(
    mesh: Mesh,
    grip: np.ndarray,
    tip: np.ndarray,
    width: float,
    thickness: float,
    weights: dict[str, float],
    part: str,
    uv_rect,
) -> None:
    axis = normalize(tip - grip, v3(0, 0, 1))
    helper = v3(0, 1, 0) if abs(float(axis[1])) < 0.9 else v3(1, 0, 0)
    right = normalize(np.cross(axis, helper), v3(1, 0, 0))
    up = normalize(np.cross(right, axis), v3(0, 1, 0))
    stations = [
        (0.0, width * 0.55, thickness * 0.9),
        (0.18, width * 1.15, thickness),
        (0.55, width, thickness * 0.85),
        (0.85, width * 0.55, thickness * 0.55),
        (1.0, 0.008, 0.006),
    ]
    rings = []
    for t, w, th in stations:
        center = lerp(grip, tip, t)
        corners = [
            center + right * w + up * th,
            center - right * w + up * th,
            center - right * w - up * th,
            center + right * w - up * th,
        ]
        rings.append([mesh.add_vertex(corner, weights) for corner in corners])
    for step in range(len(rings) - 1):
        inside = lerp(grip, tip, (step + 0.5) / (len(rings) - 1))
        for sector in range(4):
            nxt = (sector + 1) % 4
            mesh.add_quad(
                (rings[step][sector], rings[step][nxt], rings[step + 1][nxt], rings[step + 1][sector]),
                _cell_uvs(uv_rect, sector + step * 4, 4 * (len(rings) - 1)),
                part,
                inside,
            )
    _cap_loop(mesh, list(reversed(rings[0])), grip - axis * 0.01, part, uv_rect)
    _cap_loop(mesh, rings[-1], tip + axis * 0.01, part, uv_rect)


def _smooth(mesh: Mesh, amount: float = 0.35, iterations: int = 2) -> None:
    protected = set()
    for quad, part in zip(mesh.quads, mesh.parts):
        if part.startswith(("eye", "hair", "sword", "gem", "belt", "pouch")):
            protected.update(quad)
    neighbors: list[list[int]] = [[] for _ in mesh.positions]
    for quad in mesh.quads:
        for index in range(4):
            a = quad[index]
            b = quad[(index + 1) % 4]
            neighbors[a].append(b)
            neighbors[b].append(a)
    for _ in range(iterations):
        updated = [position.copy() for position in mesh.positions]
        for index, position in enumerate(mesh.positions):
            if index in protected or not neighbors[index]:
                continue
            average = np.mean([mesh.positions[other] for other in neighbors[index]], axis=0)
            updated[index] = position + (average - position) * amount
        mesh.positions = updated


def _landmarks(scale: float) -> dict[str, np.ndarray]:
    # Stylized adult ~1.7 m, slightly large head, A-pose with soft knee bend.
    hip_y = 0.92 * scale
    shoulder_y = 1.34 * scale
    head_y = 1.55 * scale
    hip_x = 0.13 * scale
    return {
        "root": v3(0.0, 0.0, 0.0),
        "pelvis": v3(0.0, hip_y, 0.02 * scale),
        "spine_01": v3(0.0, hip_y + 0.11 * scale, 0.03 * scale),
        "spine_02": v3(0.0, hip_y + 0.24 * scale, 0.04 * scale),
        "chest": v3(0.0, shoulder_y - 0.05 * scale, 0.05 * scale),
        "neck_01": v3(0.0, shoulder_y + 0.05 * scale, 0.04 * scale),
        "head": v3(0.0, head_y, 0.06 * scale),
        "clavicle_l": v3(-0.07 * scale, shoulder_y, 0.03 * scale),
        "clavicle_r": v3(0.07 * scale, shoulder_y, 0.03 * scale),
        "upperarm_l": v3(-0.17 * scale, shoulder_y - 0.01 * scale, 0.02 * scale),
        "upperarm_r": v3(0.17 * scale, shoulder_y - 0.01 * scale, 0.02 * scale),
        "forearm_l": v3(-0.30 * scale, 1.10 * scale, 0.05 * scale),
        "forearm_r": v3(0.30 * scale, 1.10 * scale, 0.05 * scale),
        "hand_l": v3(-0.36 * scale, 0.94 * scale, 0.08 * scale),
        "hand_r": v3(0.36 * scale, 0.94 * scale, 0.08 * scale),
        "weapon_r": v3(0.40 * scale, 0.78 * scale, 0.26 * scale),
        "thigh_l": v3(-hip_x, hip_y - 0.02 * scale, 0.02 * scale),
        "thigh_r": v3(hip_x, hip_y - 0.02 * scale, 0.02 * scale),
        # Knees out and forward — gait slack without clipping the tunic.
        "calf_l": v3(-0.16 * scale, 0.50 * scale, 0.15 * scale),
        "calf_r": v3(0.16 * scale, 0.50 * scale, 0.15 * scale),
        "foot_l": v3(-0.14 * scale, 0.07 * scale, 0.01 * scale),
        "foot_r": v3(0.14 * scale, 0.07 * scale, 0.01 * scale),
        "toe_l": v3(-0.14 * scale, 0.025 * scale, 0.15 * scale),
        "toe_r": v3(0.14 * scale, 0.025 * scale, 0.15 * scale),
        "cape_01": v3(0.0, shoulder_y - 0.02 * scale, -0.10 * scale),
        "cape_02": v3(0.0, 0.62 * scale, -0.30 * scale),
    }


def generate_humanoid(spec: CreatureSpec) -> GeneratedHumanoid:
    scale = _axis(spec, "body_scale", 1.0, 0.75, 1.35)
    bulk = _axis(spec, "bulk", 1.0, 0.85, 1.15)
    landmarks = _landmarks(scale)
    mesh = Mesh()
    s = scale

    # --- Head / neck / face ---
    _add_ellipsoid(
        mesh,
        landmarks["head"],
        v3(0.095 * s, 0.105 * s, 0.092 * s),
        {"head": 1.0},
        "skin",
        (0.02, 0.02, 0.22, 0.28),
        stacks=7,
    )
    _add_tube(
        mesh,
        [landmarks["neck_01"] + v3(0, -0.02 * s, 0), landmarks["neck_01"] + v3(0, 0.05 * s, 0.01 * s)],
        [0.038 * s, 0.042 * s],
        [{"neck_01": 0.8, "chest": 0.2}, {"neck_01": 0.4, "head": 0.6}],
        "skin",
        (0.24, 0.02, 0.36, 0.16),
    )
    # Large stylized eyes
    for sign in (-1.0, 1.0):
        eye = landmarks["head"] + v3(sign * 0.042 * s, 0.01 * s, 0.078 * s)
        _add_ellipsoid(mesh, eye, v3(0.028 * s, 0.032 * s, 0.014 * s), {"head": 1.0}, "eye_white", (0.38, 0.02, 0.48, 0.12), stacks=4, slices=8)
        iris = eye + v3(0.0, -0.002 * s, 0.008 * s)
        _add_ellipsoid(mesh, iris, v3(0.016 * s, 0.018 * s, 0.010 * s), {"head": 1.0}, "eye", (0.50, 0.02, 0.58, 0.10), stacks=3, slices=8)
        pupil = eye + v3(0.0, -0.001 * s, 0.014 * s)
        _add_ellipsoid(mesh, pupil, v3(0.007 * s, 0.008 * s, 0.005 * s), {"head": 1.0}, "eye_pupil", (0.60, 0.02, 0.66, 0.08), stacks=2, slices=6)

    # Spiky brown hair — many tapered spikes from scalp
    scalp = landmarks["head"] + v3(0.0, 0.04 * s, -0.01 * s)
    hair_spikes = [
        (0.00, 0.12, -0.02, 0.07, 1.0),
        (-0.05, 0.10, -0.04, 0.06, 0.9),
        (0.05, 0.10, -0.03, 0.06, 0.9),
        (-0.08, 0.04, -0.02, 0.055, 0.85),
        (0.08, 0.05, -0.01, 0.055, 0.85),
        (-0.04, 0.08, 0.05, 0.05, 0.8),
        (0.04, 0.08, 0.05, 0.05, 0.8),
        (0.00, 0.02, -0.08, 0.06, 0.95),
        (-0.06, -0.02, -0.06, 0.05, 0.75),
        (0.06, -0.01, -0.06, 0.05, 0.75),
        (-0.03, 0.14, 0.01, 0.045, 0.7),
        (0.03, 0.13, 0.02, 0.045, 0.7),
    ]
    for hx, hy, hz, length, thick in hair_spikes:
        base = scalp + v3(hx * s, hy * s * 0.35, hz * s)
        tip = base + v3(hx * 0.35 * s, length * s, hz * 0.25 * s)
        _add_tube(
            mesh,
            [base, lerp(base, tip, 0.45), tip],
            [0.028 * s * thick, 0.018 * s * thick, 0.006 * s],
            [{"head": 1.0}, {"head": 1.0}, {"head": 1.0}],
            "hair",
            (0.02, 0.30, 0.18, 0.48),
        )
    # Hair volume cap
    _add_ellipsoid(
        mesh,
        landmarks["head"] + v3(0.0, 0.05 * s, -0.02 * s),
        v3(0.10 * s, 0.07 * s, 0.10 * s),
        {"head": 1.0},
        "hair",
        (0.20, 0.30, 0.38, 0.48),
        stacks=4,
        slices=10,
    )

    # --- Torso: white shirt + blue vest ---
    chest = landmarks["chest"]
    pelvis = landmarks["pelvis"]
    _add_tube(
        mesh,
        [
            pelvis + v3(0, -0.02 * s, 0),
            landmarks["spine_01"],
            landmarks["spine_02"],
            chest,
            chest + v3(0, 0.08 * s, 0),
        ],
        [0.095 * s * bulk, 0.11 * s * bulk, 0.125 * s * bulk, 0.14 * s * bulk, 0.115 * s * bulk],
        [
            {"pelvis": 0.8, "spine_01": 0.2},
            {"spine_01": 0.7, "spine_02": 0.3},
            {"spine_02": 0.6, "chest": 0.4},
            {"chest": 0.85, "spine_02": 0.15},
            {"chest": 0.7, "neck_01": 0.3},
        ],
        "shirt",
        (0.40, 0.02, 0.68, 0.28),
        oval=(1.0, 0.88),
    )
    # Blue vest / tunic overlay on chest
    _add_ellipsoid(
        mesh,
        chest + v3(0, -0.02 * s, 0.02 * s),
        v3(0.13 * s * bulk, 0.12 * s, 0.09 * s * bulk),
        {"chest": 0.8, "spine_02": 0.2},
        "vest",
        (0.70, 0.02, 0.92, 0.24),
        stacks=5,
        slices=10,
    )
    # Belt + pouch
    belt = pelvis + v3(0, 0.04 * s, 0.04 * s)
    _add_tube(
        mesh,
        [belt + v3(0, -0.01 * s, 0), belt + v3(0, 0.02 * s, 0)],
        [0.125 * s * bulk, 0.125 * s * bulk],
        [{"pelvis": 1.0}, {"pelvis": 1.0}],
        "belt",
        (0.02, 0.50, 0.18, 0.60),
        oval=(1.05, 0.85),
    )
    _add_ellipsoid(
        mesh,
        pelvis + v3(0.12 * s, 0.0, 0.06 * s),
        v3(0.04 * s, 0.035 * s, 0.03 * s),
        {"pelvis": 1.0},
        "pouch",
        (0.20, 0.50, 0.30, 0.60),
        stacks=3,
        slices=8,
    )

    # --- Cape (flowing blue panels) ---
    cape_top = landmarks["cape_01"]
    cape_mid = lerp(landmarks["cape_01"], landmarks["cape_02"], 0.45) + v3(0, 0, -0.04 * s)
    cape_bot = landmarks["cape_02"]
    _add_tube(
        mesh,
        [cape_top + v3(0, 0.04 * s, 0.02 * s), cape_top, cape_mid, cape_bot],
        [0.14 * s, 0.16 * s, 0.19 * s, 0.22 * s],
        [
            {"cape_01": 0.7, "chest": 0.3},
            {"cape_01": 0.85, "cape_02": 0.15},
            {"cape_01": 0.35, "cape_02": 0.65},
            {"cape_02": 1.0},
        ],
        "cape",
        (0.02, 0.62, 0.34, 0.92),
        oval=(1.35, 0.22),
    )
    # Gold emblem on cape
    _add_ellipsoid(
        mesh,
        cape_top + v3(0.0, -0.05 * s, -0.04 * s),
        v3(0.035 * s, 0.04 * s, 0.012 * s),
        {"cape_01": 1.0},
        "gem",
        (0.36, 0.62, 0.46, 0.74),
        stacks=3,
        slices=8,
    )

    # --- Arms ---
    for side, sx in (("l", -1.0), ("r", 1.0)):
        shoulder = landmarks[f"upperarm_{side}"]
        elbow = landmarks[f"forearm_{side}"]
        hand = landmarks[f"hand_{side}"]
        _add_tube(
            mesh,
            [shoulder, lerp(shoulder, elbow, 0.5), elbow],
            [0.048 * s * bulk, 0.045 * s, 0.040 * s],
            [
                {f"upperarm_{side}": 0.75, "chest": 0.25},
                {f"upperarm_{side}": 0.7, f"forearm_{side}": 0.3},
                {f"upperarm_{side}": 0.3, f"forearm_{side}": 0.7},
            ],
            "skin",
            (0.50, 0.30, 0.72, 0.48),
        )
        _add_tube(
            mesh,
            [elbow, lerp(elbow, hand, 0.55), hand],
            [0.038 * s, 0.034 * s, 0.030 * s],
            [
                {f"forearm_{side}": 1.0},
                {f"forearm_{side}": 0.55, f"hand_{side}": 0.45},
                {f"hand_{side}": 0.85, f"forearm_{side}": 0.15},
            ],
            "skin",
            (0.74, 0.30, 0.96, 0.48),
        )
        _add_ellipsoid(
            mesh,
            hand,
            v3(0.032 * s, 0.028 * s, 0.040 * s),
            {f"hand_{side}": 1.0},
            "skin",
            (0.50, 0.50, 0.64, 0.60),
            stacks=3,
            slices=8,
        )
        # Sleeve cuff (blue)
        cuff = lerp(elbow, hand, 0.15)
        _add_tube(
            mesh,
            [cuff, cuff + (hand - elbow) * 0.08],
            [0.045 * s, 0.042 * s],
            [{f"forearm_{side}": 1.0}, {f"forearm_{side}": 1.0}],
            "vest",
            (0.66, 0.50, 0.78, 0.58),
        )

    # --- Legs + boots ---
    for side in ("l", "r"):
        hip = landmarks[f"thigh_{side}"]
        knee = landmarks[f"calf_{side}"]
        ankle = landmarks[f"foot_{side}"]
        toe = landmarks[f"toe_{side}"]
        _add_tube(
            mesh,
            [hip, lerp(hip, knee, 0.5), knee],
            [0.065 * s * bulk, 0.060 * s, 0.052 * s],
            [
                {f"thigh_{side}": 0.8, "pelvis": 0.2},
                {f"thigh_{side}": 0.65, f"calf_{side}": 0.35},
                {f"thigh_{side}": 0.3, f"calf_{side}": 0.7},
            ],
            "pants",
            (0.02, 0.78, 0.28, 0.96),
        )
        _add_tube(
            mesh,
            [knee, lerp(knee, ankle, 0.55), ankle],
            [0.048 * s, 0.042 * s, 0.038 * s],
            [
                {f"calf_{side}": 1.0},
                {f"calf_{side}": 0.6, f"foot_{side}": 0.4},
                {f"foot_{side}": 0.75, f"calf_{side}": 0.25},
            ],
            "pants",
            (0.30, 0.78, 0.52, 0.96),
        )
        boot_top = lerp(knee, ankle, 0.55)
        _add_tube(
            mesh,
            [boot_top, ankle, lerp(ankle, toe, 0.55), toe],
            [0.048 * s, 0.045 * s, 0.055 * s, 0.042 * s],
            [
                {f"calf_{side}": 0.3, f"foot_{side}": 0.7},
                {f"foot_{side}": 0.8, f"toe_{side}": 0.2},
                {f"foot_{side}": 0.4, f"toe_{side}": 0.6},
                {f"toe_{side}": 1.0},
            ],
            "boot",
            (0.54, 0.78, 0.78, 0.96),
            oval=(1.05, 0.75),
        )

    # --- Crystal sword ---
    grip = landmarks["hand_r"] + v3(0.02 * s, -0.02 * s, 0.02 * s)
    guard = landmarks["weapon_r"]
    tip = guard + v3(0.04 * s, -0.08 * s, 0.42 * s)
    _add_tube(
        mesh,
        [grip, guard],
        [0.018 * s, 0.022 * s],
        [{"weapon_r": 0.5, "hand_r": 0.5}, {"weapon_r": 1.0}],
        "sword_hilt",
        (0.80, 0.50, 0.92, 0.62),
    )
    # Crossguard
    _add_ellipsoid(
        mesh,
        guard,
        v3(0.07 * s, 0.015 * s, 0.015 * s),
        {"weapon_r": 1.0},
        "sword_hilt",
        (0.80, 0.64, 0.92, 0.72),
        stacks=3,
        slices=8,
    )
    _add_blade(mesh, guard, tip, 0.045 * s, 0.012 * s, {"weapon_r": 1.0}, "sword", (0.80, 0.74, 0.98, 0.96))

    _smooth(mesh, amount=0.32, iterations=2)
    min_y = min(float(position[1]) for position in mesh.positions)
    mesh.translate(v3(0, -min_y, 0))
    for point in landmarks.values():
        point[1] -= min_y
    flipped = fix_winding(mesh)
    boundary, nonmanifold = boundary_and_nonmanifold(mesh)
    if boundary or nonmanifold:
        raise RuntimeError(
            f"offline humanoid mesh is not closed (boundary={len(boundary)} nonmanifold={len(nonmanifold)})"
        )

    proxy = Mesh()

    def _box(center, extents, weights, part, uv):
        cx, cy, cz = (float(v) for v in center)
        ex, ey, ez = (float(v) for v in extents)
        signs = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))
        ids = [proxy.add_vertex(v3(cx + sx * ex, cy + sy * ey, cz + sz * ez), weights) for sx, sy, sz in signs]
        faces = ((4, 5, 6, 7), (1, 0, 3, 2), (3, 7, 6, 2), (0, 1, 5, 4), (1, 2, 6, 5), (4, 7, 3, 0))
        for index, face in enumerate(faces):
            proxy.add_quad(tuple(ids[i] for i in face), _cell_uvs(uv, index, 6), part, center)

    _box(landmarks["chest"], v3(0.12 * s, 0.18 * s, 0.09 * s), {"chest": 1.0}, "proxy_torso", (0.02, 0.02, 0.3, 0.3))
    _box(landmarks["head"], v3(0.08 * s, 0.09 * s, 0.08 * s), {"head": 1.0}, "proxy_head", (0.34, 0.02, 0.52, 0.24))
    for side in ("l", "r"):
        _box(
            lerp(landmarks[f"thigh_{side}"], landmarks[f"foot_{side}"], 0.5),
            v3(0.045 * s, 0.26 * s, 0.045 * s),
            {f"thigh_{side}": 1.0},
            f"proxy_leg_{side}",
            (0.56, 0.02, 0.74, 0.24),
        )
    fix_winding(proxy)

    notes = [
        "offline_mvp stylized fantasy hero type1",
        f"winding_flips={flipped}",
        "sheet-inspired: spiky hair, large eyes, blue cape, crystal sword",
    ]
    return GeneratedHumanoid(mesh=mesh, proxy=proxy, landmarks=landmarks, scale=scale, notes=notes)
