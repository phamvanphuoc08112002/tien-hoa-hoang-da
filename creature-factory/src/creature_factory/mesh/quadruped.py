"""Procedural quadruped. Closed quad mesh, landmarks, and a low proxy."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from creature_factory.math3d import lerp, normalize, v3
from creature_factory.mesh import Mesh, boundary_and_nonmanifold, fix_winding, normalize_weights
from creature_factory.specs import CreatureSpec

SIDES = 12
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


def _scaled_stations(scale: float) -> list[dict]:
    raw = [
        (-1.22, 0.64, 0.022, 0.018, "tail", {"tail_04": 1.0}),
        (-1.06, 0.72, 0.042, 0.036, "tail", {"tail_04": 0.4, "tail_03": 0.6}),
        (-0.90, 0.78, 0.064, 0.054, "tail", {"tail_03": 1.0}),
        (-0.74, 0.84, 0.092, 0.078, "tail", {"tail_03": 0.35, "tail_02": 0.65}),
        (-0.58, 0.87, 0.12, 0.10, "tail", {"tail_02": 1.0}),
        (-0.42, 0.89, 0.15, 0.13, "tail", {"tail_02": 0.3, "tail_01": 0.7}),
        (-0.26, 0.91, 0.19, 0.165, "pelvis", {"pelvis": 0.72, "tail_01": 0.28}),
        (-0.10, 0.93, 0.205, 0.178, "spine", {"spine_01": 0.75, "pelvis": 0.25}),
        (0.06, 0.94, 0.20, 0.172, "spine", {"spine_02": 0.8, "spine_01": 0.2}),
        (0.22, 0.96, 0.215, 0.188, "chest", {"spine_03": 0.82, "spine_02": 0.18}),
        (0.38, 0.99, 0.185, 0.162, "chest", {"spine_03": 1.0}),
        (0.50, 1.08, 0.132, 0.122, "neck", {"neck_01": 0.6, "spine_03": 0.4}),
        (0.58, 1.18, 0.118, 0.112, "neck", {"neck_01": 1.0}),
        (0.67, 1.28, 0.128, 0.12, "head", {"head": 0.7, "neck_01": 0.3}),
        (0.78, 1.34, 0.158, 0.146, "head", {"head": 1.0}),
        (0.90, 1.33, 0.138, 0.122, "head", {"head": 1.0}),
        (1.02, 1.28, 0.086, 0.074, "snout", {"head": 1.0}),
        (1.12, 1.24, 0.038, 0.032, "snout", {"head": 1.0}),
    ]
    stations = []
    for z_pos, y_pos, radius_x, radius_y, region, weights in raw:
        stations.append(
            {
                "center": v3(0.0, y_pos * scale, z_pos * scale),
                "rx": radius_x * scale,
                "ry": radius_y * scale,
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


def _extrude(mesh: Mesh, boundary: list[int], centers: list[np.ndarray], radii: list[float], weight_list, part: str, uv_rect) -> None:
    tube_uv, cap_uv = _split_tube_cap(uv_rect)
    rings = [list(boundary)]
    prev_center = np.mean([mesh.positions[index] for index in boundary], axis=0)
    steps = len(centers)
    for step, (center, radius, weights) in enumerate(zip(centers, radii, weight_list)):
        direction = center - prev_center
        length = float(np.linalg.norm(direction))
        direction = direction / length if length > 1e-8 else v3(0, -1, 0)
        new_ring = []
        for index in rings[-1]:
            radial = mesh.positions[index] - prev_center
            radial = radial - direction * float(np.dot(radial, direction))
            radial_len = float(np.linalg.norm(radial))
            if radial_len < 1e-8:
                radial = v3(radius, 0, 0)
            else:
                radial = radial / radial_len * radius
            new_ring.append(mesh.add_vertex(center + radial, weights))
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


def _place_leg(socket: np.ndarray, body_center: np.ndarray, side: float, scale: float):
    outward = socket - body_center
    outward = v3(float(outward[0]), 0.0, 0.0)
    outward = normalize(outward, v3(side, 0, 0))
    hip = socket + (body_center - socket) * 0.35
    # Bent rest pose leaves reach slack so planted feet can stride without locking the knee.
    knee = hip + normalize(v3(float(outward[0]) * 0.18, -0.55, 0.78), v3(0, -1, 0.4)) * (0.42 * scale)
    ankle = knee + normalize(v3(float(outward[0]) * 0.05, -0.92, -0.42), v3(0, -1, 0)) * (0.40 * scale)
    toe = ankle + v3(0.0, -0.04 * scale, 0.16 * scale)
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
    scale = float(spec.proportions.get("body_scale", 1.0) or 1.0)
    if scale < 0.4 or scale > 2.5:
        raise ValueError("body_scale must stay between 0.4 and 2.5 for the MVP generator")
    stations = _scaled_stations(scale)
    points = [station["center"] for station in stations]
    rights, ups = _frame(points)
    mesh = Mesh()
    rings: list[list[int]] = []
    for station, right, up in zip(stations, rights, ups):
        ring = []
        for sector in range(SIDES):
            angle = 2.0 * math.pi * sector / SIDES
            position = (
                station["center"]
                + right * math.cos(angle) * station["rx"]
                + up * math.sin(angle) * station["ry"]
            )
            ring.append(mesh.add_vertex(position, station["weights"]))
        rings.append(ring)

    quad_at: dict[tuple[int, int], int] = {}
    ring_count = len(rings) - 1
    for ring_index in range(ring_count):
        inside = (stations[ring_index]["center"] + stations[ring_index + 1]["center"]) * 0.5
        part = stations[ring_index]["region"]
        for sector in range(SIDES):
            nxt = (sector + 1) % SIDES
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
    leg_sectors = {"hl": 7, "hr": 10, "fl": 7, "fr": 10}
    parent_bone = {"fl": "spine_03", "fr": "spine_03", "hl": "pelvis", "hr": "pelvis"}

    # Creature right is +X. Sector angles start at +right, so the +X side of the
    # cross-section is the creature's right only when `right` stays +X. The
    # side sign is corrected after we read the socket.
    for side in LEG_ORDER:
        ring_index = leg_pairs[side]
        sector = leg_sectors[side]
        quad_index = quad_at[(ring_index, sector)]
        va, vb, vc, vd = mesh.quads[quad_index]
        boundary = [va, vb, vc, vd]
        socket = np.mean([mesh.positions[index] for index in boundary], axis=0)
        body_center = stations[ring_index]["center"]
        sign = 1.0 if float(socket[0] - body_center[0]) >= 0.0 else -1.0
        hip, knee, ankle, toe = _place_leg(socket, body_center, sign, scale)
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
        centers = [
            lerp(socket, knee, 0.42),
            knee,
            lerp(knee, ankle, 0.5),
            ankle,
            lerp(ankle, toe, 0.62),
            toe,
        ]
        radii = [
            hole_radius * 0.92,
            hole_radius * 0.78,
            hole_radius * 0.62,
            hole_radius * 0.55,
            hole_radius * 0.48,
            hole_radius * 0.36,
        ]
        weights = [
            {thigh: 0.8, parent: 0.2},
            {thigh: 0.45, shin: 0.55},
            {shin: 1.0},
            {shin: 0.35, foot: 0.65},
            {foot: 0.4, toe_name: 0.6},
            {toe_name: 1.0},
        ]
        remove.append(quad_index)
        _extrude(mesh, boundary, centers, radii, weights, f"leg_{side}", LEG_UV[side])

    horn_count = min(int(spec.horns), 2)
    horn_sectors = (2, 4)
    for horn_index in range(horn_count):
        sector = horn_sectors[horn_index]
        quad_index = quad_at[(14, sector)]
        boundary = list(mesh.quads[quad_index])
        socket = np.mean([mesh.positions[index] for index in boundary], axis=0)
        outward = socket - stations[14]["center"]
        direction = normalize(v3(float(outward[0]) * 0.45, 1.0, -0.2), v3(0, 1, 0))
        length = 0.18 * scale
        centers = [socket + direction * length * t for t in (0.35, 0.62, 0.84, 1.0)]
        radii = [0.03 * scale, 0.022 * scale, 0.014 * scale, 0.007 * scale]
        weights = [{"head": 1.0}] * 4
        remove.append(quad_index)
        _extrude(mesh, boundary, centers, radii, weights, f"horn_{horn_index}", HORN_UV[horn_index])

    spike_count = min(int(spec.spikes), 4)
    spike_rings = (4, 7, 8, 11)
    for spike_index in range(spike_count):
        ring_index = spike_rings[spike_index]
        quad_index = quad_at[(ring_index, 3)]
        if quad_index in remove:
            continue
        boundary = list(mesh.quads[quad_index])
        socket = np.mean([mesh.positions[index] for index in boundary], axis=0)
        direction = normalize(v3(0.0, 1.0, -0.05), v3(0, 1, 0))
        length = 0.10 * scale
        centers = [socket + direction * length * t for t in (0.45, 0.75, 1.0)]
        radii = [0.02 * scale, 0.014 * scale, 0.006 * scale]
        bone = stations[ring_index]["weights"]
        weights = [bone, bone, bone]
        remove.append(quad_index)
        _extrude(mesh, boundary, centers, radii, weights, f"spike_{spike_index}", SPIKE_UV[spike_index])

    _delete_quads(mesh, remove)

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
