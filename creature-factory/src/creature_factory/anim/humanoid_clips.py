"""Procedural biped clips for the type-1 hero: idle walk run attack skill hurt die."""

from __future__ import annotations

import math

import numpy as np

from creature_factory.anim.clips import Clip
from creature_factory.math3d import ID_QUAT, clamp, normalize, quat_from_euler_xyz, quat_from_to, quat_inv, quat_mul, v3
from creature_factory.rig.skeleton import Skeleton

HUMANOID_CLIP_NAMES = ("idle", "walk", "run", "attack", "skill", "hurt", "die")
LEGS = ("l", "r")
WALK_PHASE = {"l": 0.0, "r": 0.5}


def _times(duration: float, fps: float) -> list[float]:
    frames = max(2, int(round(duration * fps)))
    return [round(duration * index / (frames - 1), 6) for index in range(frames)]


def _q(quat: np.ndarray) -> list[float]:
    return [round(float(value), 6) for value in quat]


def _v(vector: np.ndarray) -> list[float]:
    return [round(float(value), 6) for value in vector]


def _blank(skeleton: Skeleton, duration: float, fps: float):
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


def _finish(name, spec, times, rotations, root_translation, contacts) -> Clip:
    duration, _fps = spec
    return Clip(
        name=name,
        duration=duration,
        fps=round((len(times) - 1) / duration, 4),
        times=times,
        rotations=rotations,
        root_translation=root_translation,
        contacts=contacts,
    )


def _aim(parent_world_rot: np.ndarray, rest_offset: np.ndarray, desired_offset: np.ndarray) -> np.ndarray:
    desired = desired_offset if float(np.linalg.norm(desired_offset)) > 1e-8 else rest_offset
    world = quat_from_to(rest_offset, desired)
    return quat_mul(quat_inv(parent_world_rot), world)


def _solve_knee(hip, target, length_a, length_b, pole):
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
        pole_dir = np.cross(direction, v3(0, 0, 1))
    pole_dir = normalize(pole_dir, v3(1, 0, 0))
    knee = hip + direction * along + pole_dir * height
    return knee, clamped


def _leg_limits(skeleton: Skeleton, side: str):
    thigh = f"thigh_{side}"
    calf = f"calf_{side}"
    foot = f"foot_{side}"
    length_a = float(np.linalg.norm(skeleton.local_translation[calf]))
    length_b = float(np.linalg.norm(skeleton.local_translation[foot]))
    rest = float(np.linalg.norm(skeleton.rest_world[foot] - skeleton.rest_world[thigh]))
    return length_a, length_b, (length_a + length_b) - rest


def _foot_target(skeleton: Skeleton, side: str, phase: float, stride: float, lift: float, stance: float):
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
        calf = f"calf_{side}"
        foot = f"foot_{side}"
        toe = f"toe_{side}"
        parent = skeleton.parent[thigh]
        assert parent is not None
        hip = positions[thigh]
        length_a, length_b, _slack = _leg_limits(skeleton, side)
        pole = hip + v3(0.0, 0.0, 0.12 * skeleton.scale)
        knee, ankle = _solve_knee(hip, targets[side], length_a, length_b, pole)
        rotations[thigh] = _aim(world_rots[parent], skeleton.local_translation[calf], knee - hip)
        thigh_world = quat_mul(world_rots[parent], rotations[thigh])
        rotations[calf] = _aim(thigh_world, skeleton.local_translation[foot], ankle - knee)
        calf_world = quat_mul(thigh_world, rotations[calf])
        toe_offset = skeleton.local_translation[toe]
        flat = v3(float(toe_offset[0]), min(float(toe_offset[1]), -0.01), max(0.05 * skeleton.scale, abs(float(toe_offset[2]))))
        rotations[foot] = _aim(calf_world, toe_offset, flat)


def _choose_stride(skeleton: Skeleton) -> tuple[float, float]:
    slacks = [_leg_limits(skeleton, side)[2] for side in LEGS]
    slack = min(slacks)
    if slack < 0.03:
        raise RuntimeError(f"biped rest pose is too straight for a planted gait (slack {slack:.3f} m)")
    stride = min(0.22 * skeleton.scale, slack * 0.5)
    lift = min(0.08 * skeleton.scale, slack * 0.3)
    return stride, lift


def _gait(skeleton: Skeleton, duration: float, fps: float, stance: float, stride: float, lift: float, sway: float):
    times, rotations, root_translation, contacts = _blank(skeleton, duration, fps)
    for time in times:
        pose: dict[str, np.ndarray] = {}
        cycle = time / duration
        bob = math.sin(cycle * math.pi * 4.0) * sway
        pose["spine_01"] = quat_from_euler_xyz(bob * 0.4, 0.0, 0.0)
        pose["spine_02"] = quat_from_euler_xyz(bob * 0.6, 0.0, 0.0)
        pose["chest"] = quat_from_euler_xyz(bob * 0.3, math.sin(cycle * math.pi * 2.0) * 0.05, 0.0)
        pose["head"] = quat_from_euler_xyz(-bob * 0.4, 0.0, 0.0)
        pose["cape_01"] = quat_from_euler_xyz(0.08 + bob * 0.4, 0.0, 0.0)
        pose["cape_02"] = quat_from_euler_xyz(0.12 + bob * 0.5, math.sin(cycle * math.pi * 2.0) * 0.08, 0.0)
        arm_swing = math.sin(cycle * math.pi * 2.0) * 0.45
        pose["upperarm_l"] = quat_from_euler_xyz(arm_swing, 0.0, 0.15)
        pose["upperarm_r"] = quat_from_euler_xyz(-arm_swing, 0.0, -0.15)
        pose["forearm_l"] = quat_from_euler_xyz(-0.25 - abs(arm_swing) * 0.3, 0.0, 0.0)
        pose["forearm_r"] = quat_from_euler_xyz(-0.25 - abs(arm_swing) * 0.3, 0.0, 0.0)
        targets = {}
        contact_row = {}
        for side, offset in WALK_PHASE.items():
            phase = (cycle + offset) % 1.0
            targets[side], contact_row[side] = _foot_target(skeleton, side, phase, stride, lift, stance)
        _pose_legs(skeleton, pose, targets)
        _store(rotations, root_translation, contacts, pose, v3(0, 0, 0), contact_row)
    return times, rotations, root_translation, contacts


def build_humanoid_clips(skeleton: Skeleton) -> dict[str, Clip]:
    stride, lift = _choose_stride(skeleton)
    specs = {
        "idle": (2.0, 12.0),
        "walk": (1.0, 24.0),
        "run": (0.55, 24.0),
        "attack": (0.85, 24.0),
        "skill": (1.2, 24.0),
        "hurt": (0.5, 24.0),
        "die": (1.6, 24.0),
    }
    clips: dict[str, Clip] = {}

    times, rotations, root_translation, contacts = _blank(skeleton, *specs["idle"])
    for time in times:
        pose = {}
        breath = math.sin(time / specs["idle"][0] * math.pi * 2.0) * 0.04
        pose["spine_01"] = quat_from_euler_xyz(breath, 0.0, 0.0)
        pose["chest"] = quat_from_euler_xyz(breath * 0.8, 0.0, 0.0)
        pose["head"] = quat_from_euler_xyz(-breath * 0.5, 0.0, 0.0)
        pose["cape_01"] = quat_from_euler_xyz(0.05 + breath, 0.0, math.sin(time * 1.4) * 0.04)
        pose["cape_02"] = quat_from_euler_xyz(0.08 + breath * 1.2, math.sin(time * 1.1) * 0.06, 0.0)
        pose["upperarm_l"] = quat_from_euler_xyz(0.12, 0.0, 0.22)
        pose["upperarm_r"] = quat_from_euler_xyz(0.12, 0.0, -0.22)
        pose["forearm_l"] = quat_from_euler_xyz(-0.35, 0.0, 0.0)
        pose["forearm_r"] = quat_from_euler_xyz(-0.35, 0.0, 0.0)
        _store(rotations, root_translation, contacts, pose, v3(0, 0, 0), {side: True for side in LEGS})
    clips["idle"] = _finish("idle", specs["idle"], times, rotations, root_translation, contacts)

    times, rotations, root_translation, contacts = _gait(skeleton, *specs["walk"], 0.55, stride, lift * 0.7, 0.015)
    clips["walk"] = _finish("walk", specs["walk"], times, rotations, root_translation, contacts)
    times, rotations, root_translation, contacts = _gait(skeleton, *specs["run"], 0.36, stride * 1.4, lift * 1.25, 0.03)
    clips["run"] = _finish("run", specs["run"], times, rotations, root_translation, contacts)

    clips["attack"] = _authored(skeleton, "attack", specs["attack"], _attack_pose)
    clips["skill"] = _authored(skeleton, "skill", specs["skill"], _skill_pose)
    clips["hurt"] = _authored(skeleton, "hurt", specs["hurt"], _hurt_pose)
    clips["die"] = _authored(skeleton, "die", specs["die"], _die_pose)
    return clips


def _authored(skeleton: Skeleton, name: str, spec, poser) -> Clip:
    duration, fps = spec
    times, rotations, root_translation, contacts = _blank(skeleton, duration, fps)
    for time in times:
        pose, root_vec, planted = poser(time / duration, skeleton.scale)
        _store(rotations, root_translation, contacts, pose, root_vec, planted)
    return _finish(name, spec, times, rotations, root_translation, contacts)


def _attack_pose(u: float, scale: float):
    if u < 0.3:
        swing = -0.6 * (u / 0.3)
    elif u < 0.5:
        swing = -0.6 + 1.8 * ((u - 0.3) / 0.2)
    else:
        swing = 1.2 * (1.0 - (u - 0.5) / 0.5)
    pose = {
        "spine_02": quat_from_euler_xyz(0.0, -swing * 0.25, 0.0),
        "chest": quat_from_euler_xyz(0.1 * swing, -swing * 0.35, 0.0),
        "upperarm_r": quat_from_euler_xyz(-0.4 + swing, -0.4, -0.5 + swing * 0.4),
        "forearm_r": quat_from_euler_xyz(-0.2 - abs(swing) * 0.3, 0.0, 0.0),
        "hand_r": quat_from_euler_xyz(0.0, swing * 0.4, 0.0),
        "weapon_r": quat_from_euler_xyz(swing * 0.5, 0.0, 0.0),
        "upperarm_l": quat_from_euler_xyz(0.3, 0.0, 0.4),
        "cape_01": quat_from_euler_xyz(0.15, swing * 0.2, 0.0),
    }
    return pose, v3(0, 0, 0.03 * scale * max(swing, 0)), {"l": True, "r": True}


def _skill_pose(u: float, scale: float):
    rise = math.sin(min(u, 1.0) * math.pi)
    pose = {
        "spine_01": quat_from_euler_xyz(-0.15 * rise, 0.0, 0.0),
        "chest": quat_from_euler_xyz(-0.2 * rise, 0.0, 0.0),
        "head": quat_from_euler_xyz(-0.25 * rise, 0.0, 0.0),
        "upperarm_l": quat_from_euler_xyz(-1.2 * rise, 0.0, 0.6 * rise),
        "upperarm_r": quat_from_euler_xyz(-1.2 * rise, 0.0, -0.6 * rise),
        "forearm_l": quat_from_euler_xyz(-0.5 * rise, 0.0, 0.0),
        "forearm_r": quat_from_euler_xyz(-0.5 * rise, 0.0, 0.0),
        "cape_01": quat_from_euler_xyz(-0.2 * rise, 0.0, 0.0),
        "cape_02": quat_from_euler_xyz(-0.25 * rise, 0.0, 0.0),
    }
    return pose, v3(0, 0.04 * scale * rise, 0), {"l": True, "r": True}


def _hurt_pose(u: float, scale: float):
    if u < 0.25:
        amount = u / 0.25
    else:
        amount = 1.0 - (u - 0.25) / 0.75
    pose = {
        "spine_02": quat_from_euler_xyz(0.25 * amount, 0.45 * amount, 0.0),
        "chest": quat_from_euler_xyz(0.15 * amount, 0.3 * amount, 0.0),
        "head": quat_from_euler_xyz(0.2 * amount, -0.2 * amount, 0.0),
        "upperarm_l": quat_from_euler_xyz(0.5 * amount, 0.0, 0.5 * amount),
        "upperarm_r": quat_from_euler_xyz(0.5 * amount, 0.0, -0.5 * amount),
    }
    return pose, v3(0.02 * scale * amount, 0, -0.03 * scale * amount), {"l": True, "r": True}


def _die_pose(u: float, scale: float):
    collapse = math.sin(min(u, 1.0) * math.pi * 0.5)
    pose = {
        "spine_01": quat_from_euler_xyz(1.1 * collapse, 0.0, 0.2 * collapse),
        "spine_02": quat_from_euler_xyz(0.5 * collapse, 0.0, 0.0),
        "chest": quat_from_euler_xyz(0.35 * collapse, 0.0, 0.0),
        "neck_01": quat_from_euler_xyz(0.4 * collapse, 0.15 * collapse, 0.0),
        "head": quat_from_euler_xyz(0.3 * collapse, 0.0, 0.0),
        "thigh_l": quat_from_euler_xyz(0.55 * collapse, 0.0, 0.3 * collapse),
        "thigh_r": quat_from_euler_xyz(0.55 * collapse, 0.0, -0.3 * collapse),
        "calf_l": quat_from_euler_xyz(-0.4 * collapse, 0.0, 0.0),
        "calf_r": quat_from_euler_xyz(-0.4 * collapse, 0.0, 0.0),
        "upperarm_l": quat_from_euler_xyz(0.4 * collapse, 0.0, 0.5 * collapse),
        "upperarm_r": quat_from_euler_xyz(0.4 * collapse, 0.0, -0.5 * collapse),
        "cape_01": quat_from_euler_xyz(0.5 * collapse, 0.0, 0.0),
        "cape_02": quat_from_euler_xyz(0.6 * collapse, 0.2 * collapse, 0.0),
    }
    return pose, v3(0.0, -0.35 * scale * collapse, 0.08 * scale * collapse), {"l": False, "r": False}
