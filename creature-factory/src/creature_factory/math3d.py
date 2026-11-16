"""Small rigid-transform helpers. Quaternions are xyzw, matching glTF."""

from __future__ import annotations

import math

import numpy as np

Vec3 = np.ndarray
Quat = np.ndarray

ID_QUAT = np.array([0.0, 0.0, 0.0, 1.0], dtype=np.float64)


def v3(x: float, y: float, z: float) -> Vec3:
    return np.array([x, y, z], dtype=np.float64)


def normalize(v: Vec3, fallback: Vec3 | None = None) -> Vec3:
    n = float(np.linalg.norm(v))
    if n < 1e-12:
        if fallback is None:
            raise ValueError("cannot normalize a zero vector")
        return normalize(fallback)
    return v / n


def lerp(a: Vec3, b: Vec3, t: float) -> Vec3:
    return (1.0 - t) * a + t * b


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def quat_normalize(q: Quat) -> Quat:
    n = float(np.linalg.norm(q))
    if n < 1e-12:
        return ID_QUAT.copy()
    return q / n


def quat_mul(a: Quat, b: Quat) -> Quat:
    ax, ay, az, aw = (float(x) for x in a)
    bx, by, bz, bw = (float(x) for x in b)
    return np.array(
        [
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        ],
        dtype=np.float64,
    )


def quat_inv(q: Quat) -> Quat:
    x, y, z, w = (float(v) for v in quat_normalize(q))
    return np.array([-x, -y, -z, w], dtype=np.float64)


def quat_axis_angle(axis: Vec3, angle: float) -> Quat:
    axis_n = normalize(axis, v3(0, 1, 0))
    half = angle * 0.5
    s = math.sin(half)
    return np.array(
        [axis_n[0] * s, axis_n[1] * s, axis_n[2] * s, math.cos(half)],
        dtype=np.float64,
    )


def quat_from_euler_xyz(rx: float, ry: float, rz: float) -> Quat:
    return quat_mul(
        quat_mul(quat_axis_angle(v3(1, 0, 0), rx), quat_axis_angle(v3(0, 1, 0), ry)),
        quat_axis_angle(v3(0, 0, 1), rz),
    )


def quat_from_to(src: Vec3, dst: Vec3) -> Quat:
    a = normalize(src, v3(0, 0, 1))
    b = normalize(dst, v3(0, 0, 1))
    dot = float(np.clip(np.dot(a, b), -1.0, 1.0))
    if dot > 0.999999:
        return ID_QUAT.copy()
    if dot < -0.999999:
        axis = np.cross(a, v3(1, 0, 0))
        if float(np.linalg.norm(axis)) < 1e-6:
            axis = np.cross(a, v3(0, 1, 0))
        axis = normalize(axis)
        return np.array([axis[0], axis[1], axis[2], 0.0], dtype=np.float64)
    c = np.cross(a, b)
    return quat_normalize(np.array([c[0], c[1], c[2], 1.0 + dot], dtype=np.float64))


def quat_rotate(q: Quat, v: Vec3) -> Vec3:
    r = quat_to_mat(q)
    return r @ v


def quat_to_mat(q: Quat) -> np.ndarray:
    x, y, z, w = (float(v) for v in quat_normalize(q))
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        dtype=np.float64,
    )


def mat4(rotation: Quat, translation: Vec3) -> np.ndarray:
    m = np.eye(4, dtype=np.float64)
    m[:3, :3] = quat_to_mat(rotation)
    m[:3, 3] = translation
    return m


def mat4_mul_point(m: np.ndarray, p: Vec3) -> Vec3:
    hp = m @ np.array([p[0], p[1], p[2], 1.0], dtype=np.float64)
    return hp[:3]
