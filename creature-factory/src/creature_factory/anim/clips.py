"""Procedural clips: idle, walk, run, jump, attack, hit, and death."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from creature_factory.math3d import ID_QUAT, clamp, normalize, quat_from_euler_xyz, quat_from_to, quat_inv, quat_mul, v3
from creature_factory.rig.skeleton import Skeleton

CLIP_NAMES = ("idle", "walk", "run", "jump", "attack", "hit", "death")
LEGS = ("fl", "fr", "hl", "hr")
TROT = {"fl": 0.0, "hr": 0.0, "fr": 0.5, "hl": 0.5}


@dataclass
class Clip:
    name: str
    duration: float
    fps: float
    times: list[float]
    rotations: dict[str, list[list[float]]] = field(default_factory=dict)
    root_translation: list[list[float]] = field(default_factory=list)
    contacts: dict[str, list[bool]] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "duration": self.duration,
            "fps": self.fps,
            "times": self.times,
            "rotations": self.rotations,
            "root_translation": self.root_translation,
            "contacts": self.contacts,
            "source": "offline_mvp procedural curves",
        }


def _times(duration: float, fps: float) -> list[float]:
    frames = max(2, int(round(duration * fps)))
    return [round(duration * index / (frames - 1), 6) for index in range(frames)]


def _q(quat: np.ndarray) -> list[float]:
    return [round(float(value), 6) for value in quat]


def _v(vector: np.ndarray) -> list[float]:
    return [round(float(value), 6) for value in vector]


def _aim(parent_world_rot: np.ndarray, rest_offset: np.ndarray, desired_offset: np.ndarray) -> np.ndarray:
    desired = desired_offset if float(np.linalg.norm(desired_offset)) > 1e-8 else rest_offset
    world = quat_from_to(rest_offset, desired)
    return quat_mul(quat_inv(parent_world_rot), world)


def _solve_knee(hip: np.ndarray, target: np.ndarray, length_a: float, length_b: float, pole: np.ndarray):
    raw = target - hip
    raw_dist = float(np.linalg.norm(raw))
    max_reach = length_a + length_b - 1e-4
    min_reach = abs(length_a - length_b) + 1e-4
    dist = clamp(raw_dist, min_reach, max_reach)
    direction = raw / raw_dist if raw_dist > 1e-8 else v3(0, -1, 0)
    clamped = hip + direction * dist
    along = (length_a * length_a - length_b * length_b + dist * dist) / (2.0 * dist)
    height = math.sqrt(max(length_a * length_a - along * along, 0.0))
    pole_dir = pole - hip
    pole_dir = pole_dir - direction * float(np.dot(pole_dir, direction))
    if float(np.linalg.norm(pole_dir)) < 1e-6:
        pole_dir = np.cross(direction, v3(0, 1, 0))
    pole_dir = normalize(pole_dir, v3(1, 0, 0))
    knee = hip + direction * along + pole_dir * height
    return knee, clamped, raw_dist <= max_reach + 1e-4


def _leg_limits(skeleton: Skeleton, side: str) -> tuple[float, float, float]:
    thigh = f"thigh_{side}"
    shin = f"shin_{side}"
    foot = f"foot_{side}"
    length_a = float(np.linalg.norm(skeleton.local_translation[shin]))
    length_b = float(np.linalg.norm(skeleton.local_translation[foot]))
    rest = float(np.linalg.norm(skeleton.rest_world[foot] - skeleton.rest_world[thigh]))
    return length_a, length_b, (length_a + length_b) - rest


def _foot_target(skeleton: Skeleton, side: str, phase: float, stride: float, lift: float, stance: float) -> tuple[np.ndarray, bool]:
    rest = skeleton.rest_world[f"foot_{side}"]
    local = phase % 1.0
    if local < stance:
        u = local / stance
        z_pos = float(rest[2]) + stride * 0.5 * (1.0 - 2.0 * u)
        return v3(float(rest[0]), float(rest[1]), z_pos), True
    u = (local - stance) / (1.0 - stance)
    z_pos = float(rest[2]) - stride * 0.5 + stride * u
    y_pos = float(rest[1]) + math.sin(u * math.pi) * lift
    return v3(float(rest[0]), y_pos, z_pos), False


def _pose_legs(skeleton: Skeleton, rotations: dict[str, np.ndarray], targets: dict[str, np.ndarray]) -> None:
    positions, world_rots, _mats = skeleton.forward(rotations)
    for side in LEGS:
        thigh = f"thigh_{side}"
        shin = f"shin_{side}"
        foot = f"foot_{side}"
        toe = f"toe_{side}"
        parent = skeleton.parent[thigh]
        assert parent is not None
        hip = positions[thigh]
        length_a, length_b, _slack = _leg_limits(skeleton, side)
        pole = hip + (skeleton.rest_world[shin] - skeleton.rest_world[thigh])
        knee, ankle, _reached = _solve_knee(hip, targets[side], length_a, length_b, pole)
        rotations[thigh] = _aim(world_rots[parent], skeleton.local_translation[shin], knee - hip)
        thigh_world = quat_mul(world_rots[parent], rotations[thigh])
        rotations[shin] = _aim(thigh_world, skeleton.local_translation[foot], ankle - knee)
        shin_world = quat_mul(thigh_world, rotations[shin])
        toe_offset = skeleton.local_translation[toe]
        flat = v3(float(toe_offset[0]), min(float(toe_offset[1]), -0.01), max(0.05 * skeleton.scale, abs(float(toe_offset[2]))))
        rotations[foot] = _aim(shin_world, toe_offset, flat)


def _blank(skeleton: Skeleton, duration: float, fps: float) -> tuple[list[float], dict[str, list], list, dict[str, list]]:
    times = _times(duration, fps)
    rotations = {name: [] for name in skeleton.names if name != "root"}
    root_translation = []
    contacts = {f"foot_{side}": [] for side in LEGS}
    return times, rotations, root_translation, contacts


def _store(rotations, root_translation, contacts, pose, root_vec, contact_row):
    for name, keys in rotations.items():
        keys.append(_q(pose.get(name, ID_QUAT)))
    root_translation.append(_v(root_vec))
    for side in LEGS:
        contacts[f"foot_{side}"].append(bool(contact_row[side]))


def _gait(skeleton: Skeleton, duration: float, fps: float, stance: float, stride: float, lift: float, spine: float) -> tuple[list, dict, list, dict]:
    times, rotations, root_translation, contacts = _blank(skeleton, duration, fps)
    for time in times:
        pose: dict[str, np.ndarray] = {}
        cycle = time / duration
        bob = math.sin(cycle * math.pi * 4.0) * spine
        pose["spine_01"] = quat_from_euler_xyz(bob * 0.4, 0.0, 0.0)
        pose["spine_02"] = quat_from_euler_xyz(bob * 0.8, 0.0, 0.0)
        pose["spine_03"] = quat_from_euler_xyz(bob * 0.5, 0.0, 0.0)
        pose["head"] = quat_from_euler_xyz(-bob * 0.6, 0.0, 0.0)
        for index, bone in enumerate(("tail_01", "tail_02", "tail_03", "tail_04")):
            sway = math.sin(cycle * math.pi * 2.0 + index * 0.4) * (0.08 + index * 0.05)
            pose[bone] = quat_from_euler_xyz(0.0, sway, 0.0)
        targets = {}
        contact_row = {}
        for side, offset in TROT.items():
            phase = (cycle + offset) % 1.0
            targets[side], contact_row[side] = _foot_target(skeleton, side, phase, stride, lift, stance)
        _pose_legs(skeleton, pose, targets)
        _store(rotations, root_translation, contacts, pose, v3(0, 0, 0), contact_row)
    return times, rotations, root_translation, contacts


def _choose_stride(skeleton: Skeleton) -> tuple[float, float]:
    slacks = [_leg_limits(skeleton, side)[2] for side in LEGS]
    slack = min(slacks)
    if slack < 0.04:
        raise RuntimeError(f"leg rest pose is too straight for a planted gait (slack {slack:.3f} m)")
    stride = min(0.18 * skeleton.scale, slack * 0.45)
    lift = min(0.07 * skeleton.scale, slack * 0.28)
    return stride, lift


def build_clips(skeleton: Skeleton) -> dict[str, Clip]:
    stride, lift = _choose_stride(skeleton)
    specs = {
        "idle": (2.0, 12.0),
        "walk": (1.0, 24.0),
        "run": (0.52, 24.0),
        "jump": (1.15, 24.0),
        "attack": (0.8, 24.0),
        "hit": (0.45, 24.0),
        "death": (1.5, 24.0),
    }
    clips: dict[str, Clip] = {}

    times, rotations, root_translation, contacts = _blank(skeleton, *specs["idle"])
    for time in times:
        pose = {}
        breath = math.sin(time / specs["idle"][0] * math.pi * 2.0) * 0.05
        pose["spine_01"] = quat_from_euler_xyz(breath, 0.0, 0.0)
        pose["spine_02"] = quat_from_euler_xyz(breath * 0.7, 0.0, 0.0)
        pose["head"] = quat_from_euler_xyz(-breath * 0.5, 0.0, 0.0)
        for index, bone in enumerate(("tail_01", "tail_02", "tail_03", "tail_04")):
            pose[bone] = quat_from_euler_xyz(0.0, math.sin(time * math.pi + index * 0.35) * (0.06 + index * 0.04), 0.0)
        _store(rotations, root_translation, contacts, pose, v3(0, 0, 0), {side: True for side in LEGS})
    clips["idle"] = _finish("idle", specs["idle"], times, rotations, root_translation, contacts)

    times, rotations, root_translation, contacts = _gait(skeleton, specs["walk"][0], specs["walk"][1], 0.5, stride, lift * 0.65, 0.02)
    clips["walk"] = _finish("walk", specs["walk"], times, rotations, root_translation, contacts)

    times, rotations, root_translation, contacts = _gait(
        skeleton, specs["run"][0], specs["run"][1], 0.34, stride * 1.35, lift * 1.3, 0.035
    )
    clips["run"] = _finish("run", specs["run"], times, rotations, root_translation, contacts)

    clips["jump"] = _authored(skeleton, "jump", specs["jump"], _jump_pose)
    clips["attack"] = _authored(skeleton, "attack", specs["attack"], _attack_pose)
    clips["hit"] = _authored(skeleton, "hit", specs["hit"], _hit_pose)
    clips["death"] = _authored(skeleton, "death", specs["death"], _death_pose)
    return clips


def _finish(name, spec, times, rotations, root_translation, contacts) -> Clip:
    duration, nominal_fps = spec
    return Clip(
        name=name,
        duration=duration,
        fps=round((len(times) - 1) / duration, 4),
        times=times,
        rotations=rotations,
        root_translation=root_translation,
        contacts=contacts,
    )


def _authored(skeleton: Skeleton, name: str, spec, poser) -> Clip:
    duration, fps = spec
    times, rotations, root_translation, contacts = _blank(skeleton, duration, fps)
    for time in times:
        pose, root_vec = poser(time / duration, skeleton.scale)
        _store(rotations, root_translation, contacts, pose, root_vec, {side: False for side in LEGS})
    return _finish(name, spec, times, rotations, root_translation, contacts)


def _jump_pose(u: float, scale: float):
    if u < 0.18:
        crouch = u / 0.18
        y_pos = -0.05 * scale * crouch
        bend = 0.45 * crouch
    elif u < 0.45:
        p = (u - 0.18) / 0.27
        y_pos = (-0.05 + 0.62 * math.sin(p * math.pi * 0.5)) * scale
        bend = 0.45 * (1.0 - p)
    elif u < 0.72:
        p = (u - 0.45) / 0.27
        y_pos = (0.57 - 0.18 * p) * scale
        bend = -0.15
    elif u < 0.88:
        p = (u - 0.72) / 0.16
        y_pos = (0.39 - 0.44 * p) * scale
        bend = 0.55 * p
    else:
        p = (u - 0.88) / 0.12
        y_pos = (-0.05 * (1.0 - p)) * scale
        bend = 0.55 * (1.0 - p)
    pose = {
        "spine_01": quat_from_euler_xyz(0.18 * math.sin(u * math.pi), 0.0, 0.0),
        "spine_02": quat_from_euler_xyz(0.12 * math.sin(u * math.pi), 0.0, 0.0),
        "thigh_fl": quat_from_euler_xyz(bend, 0.0, 0.0),
        "thigh_fr": quat_from_euler_xyz(bend, 0.0, 0.0),
        "thigh_hl": quat_from_euler_xyz(bend * 0.85, 0.0, 0.0),
        "thigh_hr": quat_from_euler_xyz(bend * 0.85, 0.0, 0.0),
        "shin_fl": quat_from_euler_xyz(-bend * 1.2, 0.0, 0.0),
        "shin_fr": quat_from_euler_xyz(-bend * 1.2, 0.0, 0.0),
        "shin_hl": quat_from_euler_xyz(-bend, 0.0, 0.0),
        "shin_hr": quat_from_euler_xyz(-bend, 0.0, 0.0),
    }
    return pose, v3(0, y_pos, 0)


def _attack_pose(u: float, scale: float):
    if u < 0.35:
        pitch = -0.45 * (u / 0.35)
    elif u < 0.55:
        pitch = -0.45 + 1.15 * ((u - 0.35) / 0.2)
    else:
        pitch = 0.70 * (1.0 - (u - 0.55) / 0.45)
    pose = {
        "neck_01": quat_from_euler_xyz(pitch, 0.0, 0.0),
        "head": quat_from_euler_xyz(pitch * 0.65, 0.0, 0.0),
        "spine_03": quat_from_euler_xyz(pitch * 0.25, 0.0, 0.0),
        "tail_01": quat_from_euler_xyz(0.0, -pitch * 0.2, 0.0),
    }
    return pose, v3(0, 0, 0.02 * scale * max(pitch, 0.0))


def _hit_pose(u: float, scale: float):
    if u < 0.22:
        yaw = 0.5 * (u / 0.22)
    else:
        yaw = 0.5 * (1.0 - (u - 0.22) / 0.78)
    pose = {
        "spine_02": quat_from_euler_xyz(0.0, yaw, 0.0),
        "spine_03": quat_from_euler_xyz(0.0, yaw * 0.6, 0.0),
        "head": quat_from_euler_xyz(-0.35 * yaw, -yaw, 0.0),
        "neck_01": quat_from_euler_xyz(-0.2 * yaw, yaw * 0.4, 0.0),
    }
    return pose, v3(0.01 * scale * yaw, 0, -0.02 * scale * yaw)


def _death_pose(u: float, scale: float):
    collapse = math.sin(min(u, 1.0) * math.pi * 0.5)
    pose = {
        "spine_01": quat_from_euler_xyz(1.05 * collapse, 0.0, 0.15 * collapse),
        "spine_02": quat_from_euler_xyz(0.55 * collapse, 0.0, 0.0),
        "neck_01": quat_from_euler_xyz(0.4 * collapse, 0.2 * collapse, 0.0),
        "head": quat_from_euler_xyz(0.25 * collapse, 0.0, 0.0),
        "thigh_fl": quat_from_euler_xyz(0.4 * collapse, 0.0, 0.35 * collapse),
        "thigh_fr": quat_from_euler_xyz(0.4 * collapse, 0.0, -0.35 * collapse),
        "thigh_hl": quat_from_euler_xyz(0.7 * collapse, 0.0, 0.25 * collapse),
        "thigh_hr": quat_from_euler_xyz(0.7 * collapse, 0.0, -0.25 * collapse),
        "tail_01": quat_from_euler_xyz(0.2 * collapse, 0.5 * collapse, 0.0),
        "tail_02": quat_from_euler_xyz(0.0, 0.4 * collapse, 0.0),
        "tail_03": quat_from_euler_xyz(0.0, 0.3 * collapse, 0.0),
        "tail_04": quat_from_euler_xyz(0.0, 0.2 * collapse, 0.0),
    }
    return pose, v3(0.0, -0.12 * scale * collapse, 0.05 * scale * collapse)
