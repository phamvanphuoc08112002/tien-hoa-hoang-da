"""Quaternion convention and planted gait checks."""

import numpy as np

from creature_factory.anim.clips import CLIP_NAMES, build_clips
from creature_factory.math3d import quat_mul, quat_rotate, quat_to_mat, v3
from creature_factory.mesh.quadruped import generate_quadruped
from creature_factory.rig.skeleton import build_skeleton, skin_vertex
from creature_factory.specs import sample_emberback


def test_quaternion_multiply_matches_matrices():
    a = np.array([0.1, -0.2, 0.3, 0.9])
    b = np.array([-0.3, 0.2, 0.1, 0.8])
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    composed = quat_to_mat(quat_mul(a, b))
    chained = quat_to_mat(a) @ quat_to_mat(b)
    assert np.allclose(composed, chained, atol=1e-6)
    vector = v3(0.2, 0.4, -0.5)
    assert np.allclose(quat_rotate(a, vector), quat_to_mat(a) @ vector, atol=1e-6)


def _skeleton():
    generated = generate_quadruped(sample_emberback("preview"))
    return build_skeleton(generated.landmarks, generated.scale), generated


def test_rest_pose_matches_landmarks():
    skeleton, _generated = _skeleton()
    positions, _rots, _mats = skeleton.forward({})
    for name, expected in skeleton.rest_world.items():
        assert np.allclose(positions[name], expected, atol=1e-6), name


def test_seven_clips_and_planted_walk():
    skeleton, generated = _skeleton()
    clips = build_clips(skeleton)
    assert tuple(clips) == CLIP_NAMES
    for name in ("walk", "run"):
        clip = clips[name]
        max_error = 0.0
        for frame, time in enumerate(clip.times):
            pose = {bone: np.array(keys[frame]) for bone, keys in clip.rotations.items()}
            positions, _rots, _mats = skeleton.forward(pose, np.array(clip.root_translation[frame]))
            for side in ("fl", "fr", "hl", "hr"):
                if not clip.contacts[f"foot_{side}"][frame]:
                    continue
                if frame > 0 and not clip.contacts[f"foot_{side}"][frame - 1]:
                    continue
                if frame + 1 < len(clip.times) and not clip.contacts[f"foot_{side}"][frame + 1]:
                    continue
                # Compare with the next planted frame inside the same contact run.
                nxt = frame + 1
                pose_n = {bone: np.array(keys[nxt]) for bone, keys in clip.rotations.items()}
                pos_n, _r, _m = skeleton.forward(pose_n, np.array(clip.root_translation[nxt]))
                delta = pos_n[f"foot_{side}"] - positions[f"foot_{side}"]
                dt = clip.times[nxt] - time
                vertical = abs(float(delta[1]))
                lateral = abs(float(delta[0]))
                # Planted feet move backward in Z at a steady rate; vertical and lateral stay put.
                max_error = max(max_error, vertical, lateral)
                assert vertical < 0.015, (name, side, frame, vertical)
                assert lateral < 0.015, (name, side, frame, lateral)
                assert float(delta[2]) < 0.01
                assert dt > 0
        assert max_error < 0.015

    # A shin-weighted vertex moves when that shin rotates; the head does not follow it.
    mesh = generated.mesh
    inverse = skeleton.inverse_bind()
    _pos, _rot, rest_mats = skeleton.forward({})
    shin_vertex = None
    for index, weights in enumerate(mesh.weights):
        if weights.get("shin_fl", 0.0) > 0.85:
            shin_vertex = index
            break
    assert shin_vertex is not None
    rest_point = skin_vertex(mesh.positions[shin_vertex], mesh.weights[shin_vertex], rest_mats, inverse)
    assert np.allclose(rest_point, mesh.positions[shin_vertex], atol=1e-4)
    bent = {"shin_fl": np.array([0.0, 0.0, np.sin(0.15), np.cos(0.15)])}
    _p, _r, bent_mats = skeleton.forward(bent)
    moved = skin_vertex(mesh.positions[shin_vertex], mesh.weights[shin_vertex], bent_mats, inverse)
    assert float(np.linalg.norm(moved - rest_point)) > 0.005
