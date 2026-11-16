"""Quad mesh container, subdivision, and topology queries."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from creature_factory.math3d import normalize, v3


def normalize_weights(weights: dict[str, float], limit: int = 4) -> dict[str, float]:
    items = [(str(k), float(v)) for k, v in weights.items() if float(v) > 1e-8]
    if not items:
        raise ValueError("vertex is missing skin weights")
    items.sort(key=lambda kv: kv[1], reverse=True)
    items = items[:limit]
    total = sum(v for _, v in items)
    return {k: v / total for k, v in items}


def blend_weights(weights: list[dict[str, float]], coeffs: list[float] | None = None) -> dict[str, float]:
    if coeffs is None:
        coeffs = [1.0] * len(weights)
    acc: dict[str, float] = {}
    scale = sum(coeffs) or 1.0
    for w, c in zip(weights, coeffs):
        for name, value in w.items():
            acc[name] = acc.get(name, 0.0) + float(value) * float(c) / scale
    return normalize_weights(acc)


@dataclass
class Mesh:
    positions: list[np.ndarray] = field(default_factory=list)
    weights: list[dict[str, float]] = field(default_factory=list)
    quads: list[tuple[int, int, int, int]] = field(default_factory=list)
    uvs: list[list[tuple[float, float]]] = field(default_factory=list)
    parts: list[str] = field(default_factory=list)
    insides: list[np.ndarray] = field(default_factory=list)

    def add_vertex(self, position, weights: dict[str, float]) -> int:
        self.positions.append(np.array(position, dtype=np.float64, copy=True))
        self.weights.append(normalize_weights(weights))
        return len(self.positions) - 1

    def add_quad(self, idxs, uvs, part: str, inside) -> int:
        if len(idxs) != 4 or len(set(int(i) for i in idxs)) < 4:
            raise ValueError(f"degenerate quad indices {idxs}")
        clean = []
        for u, v in uvs:
            clean.append((min(1.0, max(0.0, float(u))), min(1.0, max(0.0, float(v)))))
        self.quads.append(tuple(int(i) for i in idxs))
        self.uvs.append(clean)
        self.parts.append(part)
        self.insides.append(np.array(inside, dtype=np.float64, copy=True))
        return len(self.quads) - 1

    def copy(self) -> "Mesh":
        other = Mesh()
        other.positions = [p.copy() for p in self.positions]
        other.weights = [dict(w) for w in self.weights]
        other.quads = list(self.quads)
        other.uvs = [list(face) for face in self.uvs]
        other.parts = list(self.parts)
        other.insides = [p.copy() for p in self.insides]
        return other

    def translate(self, delta) -> None:
        shift = np.array(delta, dtype=np.float64)
        for position in self.positions:
            position += shift
        for inside in self.insides:
            inside += shift

    @property
    def triangle_count(self) -> int:
        return len(self.quads) * 2

    def triangles(self) -> list[tuple[int, int, int]]:
        tris = []
        for a, b, c, d in self.quads:
            tris.append((a, b, c))
            tris.append((a, c, d))
        return tris


def edge_counts(mesh: Mesh) -> dict[tuple[int, int], int]:
    counts: dict[tuple[int, int], int] = {}
    for a, b, c, d in mesh.quads:
        for edge in ((a, b), (b, c), (c, d), (d, a)):
            key = (edge[0], edge[1]) if edge[0] < edge[1] else (edge[1], edge[0])
            counts[key] = counts.get(key, 0) + 1
    return counts


def boundary_and_nonmanifold(mesh: Mesh) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    boundary = []
    nonmanifold = []
    for edge, count in edge_counts(mesh).items():
        if count == 1:
            boundary.append(edge)
        elif count != 2:
            nonmanifold.append(edge)
    return boundary, nonmanifold


def signed_volume(mesh: Mesh) -> float:
    volume = 0.0
    positions = mesh.positions
    for a, b, c, d in mesh.quads:
        pa, pb, pc, pd = positions[a], positions[b], positions[c], positions[d]
        volume += float(np.dot(pa, np.cross(pb, pc)))
        volume += float(np.dot(pa, np.cross(pc, pd)))
    return volume / 6.0


def face_normal(mesh: Mesh, quad: tuple[int, int, int, int]) -> np.ndarray:
    a, b, c, d = (mesh.positions[i] for i in quad)
    normal = np.cross(b - a, c - a) + np.cross(c - a, d - a)
    length = float(np.linalg.norm(normal))
    if length < 1e-14:
        return v3(0, 1, 0)
    return normal / length


def triangle_area(p0, p1, p2) -> float:
    return float(np.linalg.norm(np.cross(p1 - p0, p2 - p0))) * 0.5


def degenerate_quads(mesh: Mesh, min_area: float = 1e-10) -> list[int]:
    bad = []
    for index, (a, b, c, d) in enumerate(mesh.quads):
        pa, pb, pc, pd = (mesh.positions[i] for i in (a, b, c, d))
        area = triangle_area(pa, pb, pc) + triangle_area(pa, pc, pd)
        if area < min_area:
            bad.append(index)
    return bad


def vertex_normals(mesh: Mesh) -> list[np.ndarray]:
    accum = [np.zeros(3, dtype=np.float64) for _ in mesh.positions]
    for quad in mesh.quads:
        normal = face_normal(mesh, quad)
        area_vec = np.zeros(3, dtype=np.float64)
        a, b, c, d = (mesh.positions[i] for i in quad)
        area_vec = np.cross(b - a, c - a) + np.cross(c - a, d - a)
        for index in quad:
            accum[index] += area_vec
    normals = []
    for vector in accum:
        length = float(np.linalg.norm(vector))
        normals.append(vector / length if length > 1e-12 else v3(0, 1, 0))
    return normals


def fix_winding(mesh: Mesh) -> int:
    """Flip faces whose normal points toward the recorded interior point."""
    flipped = 0
    for index, quad in enumerate(mesh.quads):
        normal = face_normal(mesh, quad)
        centroid = np.mean([mesh.positions[i] for i in quad], axis=0)
        outward = centroid - mesh.insides[index]
        if float(np.linalg.norm(outward)) < 1e-10:
            continue
        if float(np.dot(normal, outward)) < 0.0:
            a, b, c, d = quad
            mesh.quads[index] = (a, d, c, b)
            uvs = mesh.uvs[index]
            mesh.uvs[index] = [uvs[0], uvs[3], uvs[2], uvs[1]]
            flipped += 1
    return flipped


def _mid_uv(a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    return ((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5)


def subdivide(mesh: Mesh) -> Mesh:
    """Linear quad subdivision. One level multiplies quad count by four."""
    child = Mesh()
    remap = [child.add_vertex(position, weights) for position, weights in zip(mesh.positions, mesh.weights)]
    face_points = []
    for quad in mesh.quads:
        point = np.mean([mesh.positions[i] for i in quad], axis=0)
        weights = blend_weights([mesh.weights[i] for i in quad])
        face_points.append(child.add_vertex(point, weights))

    edge_points: dict[tuple[int, int], int] = {}

    def edge_point(a: int, b: int) -> int:
        key = (a, b) if a < b else (b, a)
        if key not in edge_points:
            midpoint = (mesh.positions[a] + mesh.positions[b]) * 0.5
            weights = blend_weights([mesh.weights[a], mesh.weights[b]])
            edge_points[key] = child.add_vertex(midpoint, weights)
        return edge_points[key]

    for face_index, (a, b, c, d) in enumerate(mesh.quads):
        mab = edge_point(a, b)
        mbc = edge_point(b, c)
        mcd = edge_point(c, d)
        mda = edge_point(d, a)
        face_point = face_points[face_index]
        uva, uvb, uvc, uvd = mesh.uvs[face_index]
        uvmab = _mid_uv(uva, uvb)
        uvmbc = _mid_uv(uvb, uvc)
        uvmcd = _mid_uv(uvc, uvd)
        uvmda = _mid_uv(uvd, uva)
        uvf = (
            (uva[0] + uvb[0] + uvc[0] + uvd[0]) * 0.25,
            (uva[1] + uvb[1] + uvc[1] + uvd[1]) * 0.25,
        )
        inside = mesh.insides[face_index]
        part = mesh.parts[face_index]
        child.add_quad((remap[a], mab, face_point, mda), [uva, uvmab, uvf, uvmda], part, inside)
        child.add_quad((remap[b], mbc, face_point, mab), [uvb, uvmbc, uvf, uvmab], part, inside)
        child.add_quad((remap[c], mcd, face_point, mbc), [uvc, uvmcd, uvf, uvmbc], part, inside)
        child.add_quad((remap[d], mda, face_point, mcd), [uvd, uvmda, uvf, uvmcd], part, inside)
    return child


def subdivide_times(mesh: Mesh, levels: int) -> Mesh:
    current = mesh
    for _ in range(max(0, levels)):
        current = subdivide(current)
    return current


def lod_subdiv_level(base_tris: int, tri_min: int, tri_max: int) -> int:
    level = 0
    tris = base_tris
    while tris < tri_min and level < 4:
        level += 1
        tris *= 4
    if tris > tri_max or tris < tri_min:
        raise ValueError(
            f"base mesh of {base_tris} triangles cannot land in {tri_min}-{tri_max} "
            f"(closest {tris} at subdiv {level})"
        )
    return level


def frames_along(points: list[np.ndarray]) -> tuple[list[np.ndarray], list[np.ndarray], list[np.ndarray]]:
    tangents = []
    rights = []
    ups = []
    previous_up = v3(0, 1, 0)
    for index, _point in enumerate(points):
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
        tangents.append(tangent)
        rights.append(right)
        ups.append(up)
    return tangents, rights, ups
