"""Quadruped skeleton built from generator landmarks. Rest rotations are identity."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from creature_factory.math3d import ID_QUAT, mat4, quat_mul, quat_rotate, v3
from creature_factory.rig import QUADRUPED_BONES, validate_hierarchy


@dataclass
class Skeleton:
    names: list[str]
    parent: dict[str, str | None]
    children: dict[str, list[str]]
    local_translation: dict[str, np.ndarray]
    rest_world: dict[str, np.ndarray]
    scale: float

    def forward(
        self,
        local_rotations: dict[str, np.ndarray] | None = None,
        root_translation: np.ndarray | None = None,
    ) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray], dict[str, np.ndarray]]:
        rotations = local_rotations or {}
        world_pos: dict[str, np.ndarray] = {}
        world_rot: dict[str, np.ndarray] = {}
        world_mat: dict[str, np.ndarray] = {}
        extra = np.zeros(3, dtype=np.float64) if root_translation is None else np.array(root_translation, dtype=np.float64)
        for name in self.names:
            parent = self.parent[name]
            local_rot = rotations.get(name, ID_QUAT)
            local_trans = self.local_translation[name]
            if parent is None:
                world_rot[name] = local_rot
                world_pos[name] = local_trans + extra
            else:
                world_rot[name] = quat_mul(world_rot[parent], local_rot)
                world_pos[name] = world_pos[parent] + quat_rotate(world_rot[parent], local_trans)
            world_mat[name] = mat4(world_rot[name], world_pos[name])
        return world_pos, world_rot, world_mat

    def inverse_bind(self) -> dict[str, np.ndarray]:
        _pos, _rot, mats = self.forward({})
        return {name: np.linalg.inv(mats[name]) for name in self.names}

    def length(self, name: str) -> float:
        return float(np.linalg.norm(self.local_translation[name]))


def build_skeleton(landmarks: dict[str, np.ndarray], scale: float = 1.0) -> Skeleton:
    errors = validate_hierarchy(QUADRUPED_BONES)
    if errors:
        raise RuntimeError("quadruped template is invalid: " + "; ".join(errors))
    missing = [name for name, _parent in QUADRUPED_BONES if name not in landmarks]
    if missing:
        raise RuntimeError(f"landmarks missing bones: {missing}")
    parent = {name: owner for name, owner in QUADRUPED_BONES}
    children = {name: [] for name, _owner in QUADRUPED_BONES}
    local = {}
    rest = {}
    for name, owner in QUADRUPED_BONES:
        rest[name] = np.array(landmarks[name], dtype=np.float64, copy=True)
        if owner is None:
            local[name] = rest[name].copy()
        else:
            children[owner].append(name)
            local[name] = rest[name] - rest[owner]
            if float(np.linalg.norm(local[name])) < 1e-5:
                raise RuntimeError(f"bone {name} is coincident with parent {owner}")
    return Skeleton(
        names=[name for name, _owner in QUADRUPED_BONES],
        parent=parent,
        children=children,
        local_translation=local,
        rest_world=rest,
        scale=scale,
    )


def skin_vertex(position: np.ndarray, weights: dict[str, float], world_mats: dict[str, np.ndarray], inverse_bind: dict[str, np.ndarray]) -> np.ndarray:
    accum = np.zeros(3, dtype=np.float64)
    point = np.array([position[0], position[1], position[2], 1.0], dtype=np.float64)
    for bone, weight in weights.items():
        if weight <= 0:
            continue
        transformed = world_mats[bone] @ inverse_bind[bone] @ point
        accum += float(weight) * transformed[:3]
    return accum
