"""Procedural quadruped. Closed quad mesh, landmarks, and a low proxy."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from creature_factory.math3d import lerp, normalize, v3
from creature_factory.mesh import Mesh, boundary_and_nonmanifold, fix_winding, normalize_weights
from creature_factory.specs import CreatureSpec

SIDES = 20
LEG_ORDER = ("fl", "fr", "hl", "hr")

BODY_UV = (0.02, 0.02, 0.48, 0.70)
TAIL_CAP_UV = (0.02, 0.80, 0.24, 0.98)
SNOUT_CAP_UV = (0.26, 0.80, 0.48, 0.98)
LEG_UV = {
    "fl": (0.52, 0.03, 0.73, 0.34),
    "fr": (0.76, 0.03, 0.97, 0.34),
    "hl": (0.52, 0.38, 0.73, 0.69),
    "hr": (0.76, 0.38, 0.97, 0.69),
}
HORN_UV = (
    (0.52, 0.74, 0.73, 0.98),
    (0.76, 0.74, 0.97, 0.98),
)
SPIKE_UV = (
    (0.02, 0.715, 0.12, 0.785),
    (0.14, 0.715, 0.24, 0.785),
    (0.26, 0.715, 0.36, 0.785),
    (0.38, 0.715, 0.48, 0.785),
)


@dataclass
class GeneratedQuadruped:
    mesh: Mesh
    proxy: Mesh
    landmarks: dict[str, np.ndarray]
    stations: list[dict]
    scale: float
    notes: list[str] = field(default_factory=list)


def _axis(spec: CreatureSpec, name: str, default: float, low: float, high: float) -> float:
    value = float(spec.proportions.get(name, default) or default)
    return min(high, max(low, value))


def _scaled_stations(scale: float, length: float = 1.0, bulk: float = 1.0, height: float = 1.0) -> list[dict]:
    # Haunch, tucked waist, deep chest, thin neck, wide skull, long snout.
    # The tail drops, then the tip kicks up.
    raw = [
        (-1.34, 0.88, 0.020, 0.014, "tail", {"tail_04": 1.0}),
        (-1.16, 0.70, 0.040, 0.032, "tail", {"tail_04": 0.4, "tail_03": 0.6}),
        (-0.96, 0.64, 0.062, 0.050, "tail", {"tail_03": 1.0}),
        (-0.76, 0.74, 0.092, 0.078, "tail", {"tail_03": 0.35, "tail_02": 0.65}),
        (-0.56, 0.86, 0.125, 0.108, "tail", {"tail_02": 1.0}),
        (-0.36, 0.96, 0.165, 0.145, "tail", {"tail_02": 0.3, "tail_01": 0.7}),
        (-0.16, 1.02, 0.230, 0.200, "pelvis", {"pelvis": 0.72, "tail_01": 0.28}),
        (0.02, 1.00, 0.195, 0.165, "spine", {"spine_01": 0.75, "pelvis": 0.25}),
        (0.18, 1.04, 0.235, 0.205, "spine", {"spine_02": 0.8, "spine_01": 0.2}),
        (0.34, 1.08, 0.255, 0.220, "chest", {"spine_03": 0.82, "spine_02": 0.18}),
        (0.48, 1.16, 0.175, 0.155, "chest", {"spine_03": 1.0}),
        (0.58, 1.32, 0.112, 0.125, "neck", {"neck_01": 0.6, "spine_03": 0.4}),
        (0.66, 1.48, 0.100, 0.112, "neck", {"neck_01": 1.0}),
        (0.78, 1.58, 0.155, 0.145, "head", {"head": 0.7, "neck_01": 0.3}),
        (0.92, 1.60, 0.190, 0.155, "head", {"head": 1.0}),
        (1.06, 1.52, 0.145, 0.115, "head", {"head": 1.0}),
        (1.22, 1.42, 0.078, 0.055, "snout", {"head": 1.0}),
        (1.36, 1.36, 0.026, 0.018, "snout", {"head": 1.0}),
    ]
    stations = []
    for z_pos, y_pos, radius_x, radius_y, region, weights in raw:
        stations.append(
            {
                "center": v3(0.0, y_pos * height * scale, z_pos * length * scale),
                "rx": radius_x * bulk * scale,
                "ry": radius_y * bulk * scale,
                "region": region,
                "weights": {name: float(value) for name, value in weights.items()},
            }
        )
    return stations


def _spine_landmarks(stations: list[dict]) -> dict[str, np.ndarray]:
    centers = [station["center"] for station in stations]
    return {
        "root": v3(0, 0, 0),
        "pelvis": centers[6].copy(),
        "spine_01": centers[7].copy(),
        "spine_02": centers[8].copy(),
        "spine_03": centers[9].copy(),
        "neck_01": centers[12].copy(),
        "head": centers[14].copy(),
        "tail_01": centers[5].copy(),
        "tail_02": centers[4].copy(),
        "tail_03": centers[2].copy(),
        "tail_04": centers[1].copy(),
    }


def _section(angle: float, rx: float, ry: float, region: str) -> tuple[float, float]:
    """Rounder than an ellipse, with a back ridge and a dropped belly."""
    cosine = math.cos(angle)
    sine = math.sin(angle)
    power = 2.0 / 2.35
    px = math.copysign(abs(cosine) ** power, cosine)
    py = math.copysign(abs(sine) ** power, sine)
    if region in {"head", "snout"}:
        px *= 1.12
        if sine < 0.0:
            py *= 0.82
        if region == "snout" and sine > 0.0:
            py *= 0.7
    ridge = 0.0
    belly = 1.0
    if region in {"tail", "pelvis", "spine", "chest", "neck"}:
        if sine > 0.4:
            ridge = (sine - 0.4) * 0.62 * ry
        if sine < -0.15:
            belly = 1.22
    return px * rx, py * ry * belly + ridge


def _frame(points: list[np.ndarray]) -> tuple[list[np.ndarray], list[np.ndarray]]:
    rights = []
    ups = []
    previous_up = v3(0, 1, 0)
    for index in range(len(points)):
        if index == 0:
            tangent = points[1] - points[0]
        elif index == len(points) - 1:
            tangent = points[-1] - points[-2]
        else:
            tangent = points[index + 1] - points[index - 1]
        tangent = normalize(tangent, v3(0, 0, 1))
        right = np.cross(previous_up, tangent)
        if float(np.linalg.norm(right)) < 1e-6:
            right = np.cross(v3(1, 0, 0), tangent)
        right = normalize(right, v3(1, 0, 0))
        up = normalize(np.cross(tangent, right), v3(0, 1, 0))
        previous_up = up
        rights.append(right)
        ups.append(up)
    return rights, ups


def _ring_uv(rect, sector: int, v_a: float, v_b: float, sides: int):
    u0, v0, u1, v1 = rect
    sector2 = (sector + 1) % sides

    def u_at(seg: int, seam_end: bool = False) -> float:
        frac = 1.0 if seam_end else seg / sides
        return u0 + frac * (u1 - u0)

    return [
        (u_at(sector), v0 + v_a * (v1 - v0)),
        (u_at(sector2, sector2 == 0), v0 + v_a * (v1 - v0)),
        (u_at(sector2, sector2 == 0), v0 + v_b * (v1 - v0)),
        (u_at(sector), v0 + v_b * (v1 - v0)),
    ]


def _cell_uvs(rect, index: int, count: int):
    u0, v0, u1, v1 = rect
    count = max(count, 1)
    width = (u1 - u0) / count
    pad = min(0.0015, width * 0.08)
    left = u0 + index * width + pad
    right = u0 + (index + 1) * width - pad
    bottom = v0 + pad
    top = v1 - pad
    return [(left, bottom), (right, bottom), (right, top), (left, top)]


def _split_tube_cap(rect, cap_frac: float = 0.2):
    u0, v0, u1, v1 = rect
    cap_h = (v1 - v0) * cap_frac
    gap = min(0.004, cap_h * 0.2)
    tube = (u0, v0, u1, v1 - cap_h - gap)
    cap = (u0, v1 - cap_h, u1, v1)
    return tube, cap


def _delete_quads(mesh: Mesh, indices: list[int]) -> None:
    for index in sorted(set(indices), reverse=True):
        del mesh.quads[index]
        del mesh.uvs[index]
        del mesh.parts[index]
        del mesh.insides[index]


def _cap_loop(mesh: Mesh, ring: list[int], inside: np.ndarray, part: str, uv_rect) -> None:
    loop = list(ring)
    quads = []
    while len(loop) > 4:
        quads.append((loop[0], loop[1], loop[2], loop[-1]))
        loop = loop[2:]
    if len(loop) != 4:
        raise RuntimeError(f"cap loop ended at {len(loop)} vertices")
    quads.append(tuple(loop))
    for index, quad in enumerate(quads):
        mesh.add_quad(quad, _cell_uvs(uv_rect, index, len(quads)), part, inside)


def _extrude(
    mesh: Mesh,
    boundary: list[int],
    centers: list[np.ndarray],
    radii: list[float],
    weight_list,
    part: str,
    uv_rect,
    profiles: list[tuple[float, float]] | None = None,
) -> None:
    tube_uv, cap_uv = _split_tube_cap(uv_rect)
    rings = [list(boundary)]
    prev_center = np.mean([mesh.positions[index] for index in boundary], axis=0)
    steps = len(centers)
    for step, (center, radius, weights) in enumerate(zip(centers, radii, weight_list)):
        direction = center - prev_center
        length = float(np.linalg.norm(direction))
        direction = direction / length if length > 1e-8 else v3(0, -1, 0)
        width_mul, height_mul = (1.0, 1.0) if profiles is None else profiles[step]
        up_axis = v3(0.0, 1.0, 0.0) - direction * float(np.dot(v3(0.0, 1.0, 0.0), direction))
        if float(np.linalg.norm(up_axis)) < 1e-6:
            up_axis = v3(1.0, 0.0, 0.0)
        up_axis = normalize(up_axis)
        side_axis = normalize(np.cross(up_axis, direction), v3(1.0, 0.0, 0.0))
        new_ring = []
        for index in rings[-1]:
            radial = mesh.positions[index] - prev_center
            radial = radial - direction * float(np.dot(radial, direction))
            side_amount = float(np.dot(radial, side_axis))
            up_amount = float(np.dot(radial, up_axis))
            if abs(side_amount) < 1e-8 and abs(up_amount) < 1e-8:
                side_amount = radius
            angle = math.atan2(up_amount, side_amount)
            offset = side_axis * math.cos(angle) * radius * width_mul + up_axis * math.sin(angle) * radius * height_mul
            new_ring.append(mesh.add_vertex(center + offset, weights))
        inside = (prev_center + center) * 0.5
        sides = len(rings[-1])
        v_a = step / steps
        v_b = (step + 1) / steps
        for sector in range(sides):
            nxt = (sector + 1) % sides
            mesh.add_quad(
                (rings[-1][sector], rings[-1][nxt], new_ring[nxt], new_ring[sector]),
                _ring_uv(tube_uv, sector, v_a, v_b, sides),
                part,
                inside,
            )
        rings.append(new_ring)
        prev_center = np.array(center, dtype=np.float64, copy=True)
    _cap_loop(mesh, rings[-1], prev_center, part, cap_uv)


def _mix(mesh: Mesh, index: int, extra: dict[str, float], amount: float) -> None:
    mixed = {name: value * (1.0 - amount) for name, value in mesh.weights[index].items()}
    for name, value in extra.items():
        mixed[name] = mixed.get(name, 0.0) + float(value) * amount
    mesh.weights[index] = normalize_weights(mixed)


def _place_leg(socket: np.ndarray, body_center: np.ndarray, side: float, scale: float, leg: float = 1.0, forward: float = 1.0):
    outward = socket - body_center
    outward = v3(float(outward[0]), 0.0, 0.0)
    outward = normalize(outward, v3(side, 0, 0))
    hip = socket + (body_center - socket) * 0.22
    # Front knees fold forward, hind knees fold back. The bend keeps gait slack.
    ox = float(outward[0])
    knee = hip + normalize(v3(ox * 0.28, -0.72, 0.62 * forward), v3(0, -1, 0)) * (0.40 * scale * leg)
    ankle = knee + normalize(v3(ox * 0.06, -0.94, -0.28 * forward), v3(0, -1, 0)) * (0.36 * scale * leg)
    toe = ankle + v3(ox * 0.02 * scale, -0.012 * scale, 0.22 * scale)
    return hip, knee, ankle, toe


def _add_box(mesh: Mesh, center: np.ndarray, extents: np.ndarray, weights: dict[str, float], part: str, uv_rect) -> None:
    cx, cy, cz = (float(v) for v in center)
    ex, ey, ez = (float(v) for v in extents)
    signs = (
        (-1, -1, -1),
        (1, -1, -1),
        (1, 1, -1),
        (-1, 1, -1),
        (-1, -1, 1),
        (1, -1, 1),
        (1, 1, 1),
        (-1, 1, 1),
    )
    ids = [
        mesh.add_vertex(v3(cx + sx * ex, cy + sy * ey, cz + sz * ez), weights)
        for sx, sy, sz in signs
    ]
    faces = (
        (4, 5, 6, 7),
        (1, 0, 3, 2),
        (3, 7, 6, 2),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (4, 7, 3, 0),
    )
    for index, face in enumerate(faces):
        mesh.add_quad(tuple(ids[i] for i in face), _cell_uvs(uv_rect, index, 6), part, center)


def _smooth(mesh: Mesh, amount: float = 0.42, iterations: int = 2) -> None:
    """Round the cage without opening it. Eyes stay crisp."""
    protected = set()
    for quad, part in zip(mesh.quads, mesh.parts):
        if part.startswith("eye"):
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


def _add_eye(mesh: Mesh, center: np.ndarray, radius: float, weights: dict[str, float], part: str, uv_rect) -> None:
    slices = 6
    levels = (0.72, 0.28, -0.28, -0.72)
    rings = []
    for unit in levels:
        ring_r = math.sqrt(max(1.0 - unit * unit, 0.0)) * radius
        ring = []
        for sector in range(slices):
            angle = 2.0 * math.pi * sector / slices
            ring.append(
                mesh.add_vertex(
                    center + v3(math.cos(angle) * ring_r, unit * radius, math.sin(angle) * ring_r),
                    weights,
                )
            )
        rings.append(ring)
    steps = len(rings) - 1
    for step in range(steps):
        for sector in range(slices):
            nxt = (sector + 1) % slices
            mesh.add_quad(
                (rings[step][sector], rings[step][nxt], rings[step + 1][nxt], rings[step + 1][sector]),
                _ring_uv(uv_rect, sector, step / steps, (step + 1) / steps, slices),
                part,
                center,
            )
    cap_uv = (uv_rect[0], uv_rect[1], uv_rect[2], uv_rect[1] + (uv_rect[3] - uv_rect[1]) * 0.2)
    _cap_loop(mesh, rings[0], center, part, cap_uv)
    _cap_loop(mesh, list(reversed(rings[-1])), center, part, cap_uv)


def build_proxy(landmarks: dict[str, np.ndarray], scale: float) -> Mesh:
    mesh = Mesh()
    pelvis = landmarks["pelvis"]
    chest = landmarks["spine_03"]
    body_center = (pelvis + chest) * 0.5
    body_len = abs(float(chest[2] - pelvis[2])) * 0.55 + 0.08 * scale
    _add_box(
        mesh,
        body_center,
        v3(0.16 * scale, 0.14 * scale, body_len),
        {"spine_02": 0.5, "pelvis": 0.5},
        "proxy_body",
        (0.02, 0.02, 0.30, 0.30),
    )
    _add_box(
        mesh,
        landmarks["head"],
        v3(0.11 * scale, 0.10 * scale, 0.12 * scale),
        {"head": 1.0},
        "proxy_head",
        (0.34, 0.02, 0.52, 0.24),
    )
    tail_center = (landmarks["tail_02"] + landmarks["tail_04"]) * 0.5
    _add_box(
        mesh,
        tail_center,
        v3(0.05 * scale, 0.04 * scale, abs(float(landmarks["tail_01"][2] - landmarks["tail_04"][2])) * 0.45),
        {"tail_02": 1.0},
        "proxy_tail",
        (0.56, 0.02, 0.74, 0.20),
    )
    uv_slots = {
        "fl": (0.02, 0.40, 0.22, 0.62),
        "fr": (0.26, 0.40, 0.46, 0.62),
        "hl": (0.50, 0.40, 0.70, 0.62),
        "hr": (0.74, 0.40, 0.94, 0.62),
    }
    for side in LEG_ORDER:
        knee = landmarks[f"shin_{side}"]
        ankle = landmarks[f"foot_{side}"]
        center = lerp(knee, ankle, 0.55)
        direction = ankle - knee
        length = float(np.linalg.norm(direction))
        _add_box(
            mesh,
            center,
            v3(0.045 * scale, max(0.08 * scale, length * 0.45), 0.045 * scale),
            {f"shin_{side}": 1.0},
            f"proxy_leg_{side}",
            uv_slots[side],
        )
    fix_winding(mesh)
    return mesh


def generate_quadruped(spec: CreatureSpec) -> GeneratedQuadruped:
    scale = _axis(spec, "body_scale", 1.0, 0.4, 2.5)
    length = _axis(spec, "length", 1.0, 0.75, 1.45)
    bulk = _axis(spec, "bulk", 1.0, 0.65, 1.45)
    height = _axis(spec, "height", 1.0, 0.8, 1.35)
    leg = _axis(spec, "leg", 1.0, 0.7, 1.35)
    horn_scale = _axis(spec, "horn", 1.0, 0.6, 1.8)
    stations = _scaled_stations(scale, length, bulk, height)
    points = [station["center"] for station in stations]
    rights, ups = _frame(points)
    mesh = Mesh()
    rings: list[list[int]] = []
    for station, right, up in zip(stations, rights, ups):
        ring = []
        for sector in range(SIDES):
            angle = 2.0 * math.pi * sector / SIDES
            sx, sy = _section(angle, station["rx"], station["ry"], station["region"])
            position = station["center"] + right * sx + up * sy
            ring.append(mesh.add_vertex(position, station["weights"]))
        rings.append(ring)

    quad_at: dict[tuple[int, int], int] = {}
    ring_count = len(rings) - 1
    for ring_index in range(ring_count):
        inside = (stations[ring_index]["center"] + stations[ring_index + 1]["center"]) * 0.5
        region = stations[ring_index]["region"]
        for sector in range(SIDES):
            nxt = (sector + 1) % SIDES
            mid = 2.0 * math.pi * (sector + 0.5) / SIDES
            part = "belly" if region in {"tail", "pelvis", "spine", "chest", "neck"} and math.sin(mid) < -0.45 else region
            v_a = ring_index / ring_count
            v_b = (ring_index + 1) / ring_count
            quad_at[(ring_index, sector)] = mesh.add_quad(
                (
                    rings[ring_index][sector],
                    rings[ring_index][nxt],
                    rings[ring_index + 1][nxt],
                    rings[ring_index + 1][sector],
                ),
                _ring_uv(BODY_UV, sector, v_a, v_b, SIDES),
                part,
                inside,
            )

    _cap_loop(mesh, rings[0], stations[1]["center"], "tail", TAIL_CAP_UV)
    _cap_loop(mesh, list(reversed(rings[-1])), stations[-2]["center"], "snout", SNOUT_CAP_UV)

    landmarks = _spine_landmarks(stations)
    remove: list[int] = []
    leg_pairs = {"hl": 6, "hr": 6, "fl": 9, "fr": 9}
    # Two underside sectors: left hole centered near 225°, right hole near 315°.
    leg_sectors = {"hl": 12, "hr": 17, "fl": 12, "fr": 17}
    parent_bone = {"fl": "spine_03", "fr": "spine_03", "hl": "pelvis", "hr": "pelvis"}

    # Creature right is +X. Sector angles start at +right, so the +X side of the
    # cross-section is the creature's right only when `right` stays +X. The
    # side sign is corrected after we read the socket.
    for side in LEG_ORDER:
        ring_index = leg_pairs[side]
        sector = leg_sectors[side]
        next_sector = (sector + 1) % SIDES
        boundary = [
            rings[ring_index][sector],
            rings[ring_index][next_sector],
            rings[ring_index][(sector + 2) % SIDES],
            rings[ring_index + 1][(sector + 2) % SIDES],
            rings[ring_index + 1][next_sector],
            rings[ring_index + 1][sector],
        ]
        socket = np.mean([mesh.positions[index] for index in boundary], axis=0)
        body_center = stations[ring_index]["center"]
        sign = 1.0 if float(socket[0] - body_center[0]) >= 0.0 else -1.0
        forward = 1.0 if side.startswith("f") else -1.0
        hip, knee, ankle, toe = _place_leg(socket, body_center, sign, scale, leg, forward)
        landmarks[f"thigh_{side}"] = hip
        landmarks[f"shin_{side}"] = knee
        landmarks[f"foot_{side}"] = ankle
        landmarks[f"toe_{side}"] = toe
        thigh = f"thigh_{side}"
        shin = f"shin_{side}"
        foot = f"foot_{side}"
        toe_name = f"toe_{side}"
        parent = parent_bone[side]
        for index in boundary:
            _mix(mesh, index, {thigh: 0.75, parent: 0.25}, 0.7)
        hole_radius = float(np.mean([np.linalg.norm(mesh.positions[index] - socket) for index in boundary]))
        thigh_r = max(hole_radius * 1.15, 0.11 * scale * (0.8 + 0.35 * bulk))
        centers = [
            lerp(socket, knee, 0.28),
            knee,
            lerp(knee, ankle, 0.55),
            ankle,
            lerp(ankle, toe, 0.45),
            toe,
        ]
        radii = [
            thigh_r * 1.05,
            thigh_r * 0.92,
            thigh_r * 0.62,
            thigh_r * 0.50,
            thigh_r * 0.95,
            thigh_r * 0.72,
        ]
        profiles = [
            (1.05, 1.15),
            (1.10, 1.00),
            (0.95, 1.15),
            (0.90, 0.85),
            (2.15, 0.42),
            (1.75, 0.36),
        ]
        weights = [
            {thigh: 0.8, parent: 0.2},
            {thigh: 0.45, shin: 0.55},
            {shin: 1.0},
            {shin: 0.35, foot: 0.65},
            {foot: 0.4, toe_name: 0.6},
            {toe_name: 1.0},
        ]
        remove.append(quad_at[(ring_index, sector)])
        remove.append(quad_at[(ring_index, next_sector)])
        _extrude(mesh, boundary, centers, radii, weights, f"leg_{side}", LEG_UV[side], profiles)

    horn_count = min(int(spec.horns), 2)
    horn_sectors = (3, 7)
    for horn_index in range(horn_count):
        sector = horn_sectors[horn_index]
        quad_index = quad_at[(14, sector)]
        boundary = list(mesh.quads[quad_index])
        socket = np.mean([mesh.positions[index] for index in boundary], axis=0)
        outward = socket - stations[14]["center"]
        length = 0.36 * scale * horn_scale
        base = normalize(v3(float(outward[0]) * 0.55, 1.0, 0.08), v3(0, 1, 0))
        swept = normalize(v3(float(outward[0]) * 0.12, 0.45, -1.0), v3(0, 1, -0.4))
        centers = []
        for t in (0.22, 0.42, 0.62, 0.82, 1.0):
            direction = normalize(base * (1.0 - t) + swept * (t * 0.9), v3(0, 1, 0))
            centers.append(socket + direction * length * t)
        radii = [0.050 * scale, 0.040 * scale, 0.028 * scale, 0.016 * scale, 0.007 * scale]
        weights = [{"head": 1.0}] * 5
        remove.append(quad_index)
        _extrude(mesh, boundary, centers, radii, weights, f"horn_{horn_index}", HORN_UV[horn_index])

    spike_count = min(int(spec.spikes), 4)
    spike_rings = (4, 7, 8, 11)
    for spike_index in range(spike_count):
        ring_index = spike_rings[spike_index]
        quad_index = quad_at[(ring_index, SIDES // 4)]
        if quad_index in remove:
            continue
        boundary = list(mesh.quads[quad_index])
        socket = np.mean([mesh.positions[index] for index in boundary], axis=0)
        length = 0.18 * scale
        direction = normalize(v3(0.0, 0.9, -0.35), v3(0, 1, 0))
        centers = [socket + direction * length * t for t in (0.4, 0.72, 1.0)]
        radii = [0.032 * scale, 0.018 * scale, 0.006 * scale]
        bone = stations[ring_index]["weights"]
        weights = [bone, bone, bone]
        remove.append(quad_index)
        _extrude(mesh, boundary, centers, radii, weights, f"spike_{spike_index}", SPIKE_UV[spike_index])

    head = stations[14]
    skull_forward = normalize(stations[15]["center"] - stations[13]["center"], v3(0, 0, 1))
    eye_uvs = ((0.52, 0.74, 0.64, 0.86), (0.66, 0.74, 0.78, 0.86))
    for eye_index, sign in enumerate((-1.0, 1.0)):
        eye_center = (
            head["center"]
            + rights[14] * sign * head["rx"] * 0.92
            + ups[14] * head["ry"] * 0.28
            + skull_forward * head["rx"] * 0.35
        )
        _add_eye(mesh, eye_center, 0.042 * scale, {"head": 1.0}, f"eye_{eye_index}", eye_uvs[eye_index])

    _delete_quads(mesh, remove)
    _smooth(mesh)

    min_y = min(float(position[1]) for position in mesh.positions)
    mesh.translate(v3(0, -min_y, 0))
    for name, point in landmarks.items():
        point[1] -= min_y
    flipped = fix_winding(mesh)
    boundary, nonmanifold = boundary_and_nonmanifold(mesh)
    if boundary or nonmanifold:
        raise RuntimeError(
            f"offline quadruped mesh is not closed "
            f"(boundary={len(boundary)} nonmanifold={len(nonmanifold)})"
        )
    proxy = build_proxy(landmarks, scale)
    notes = [
        "offline_mvp pure-Python quadruped",
        f"winding_flips={flipped}",
        "no wings; four legs, one head, one tail",
    ]
    return GeneratedQuadruped(mesh=mesh, proxy=proxy, landmarks=landmarks, stations=stations, scale=scale, notes=notes)
