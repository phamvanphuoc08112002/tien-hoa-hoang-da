"""Mesh topology checks for the offline quadruped."""

from creature_factory.mesh import (
    boundary_and_nonmanifold,
    degenerate_quads,
    signed_volume,
    subdivide_times,
)
from creature_factory.mesh.quadruped import generate_quadruped
from creature_factory.specs import CreatureSpec


def _spec(**overrides) -> CreatureSpec:
    data = dict(
        species="Emberback",
        archetype="quadruped",
        horns=2,
        spikes=0,
        wing_count=0,
        leg_count=4,
        head_count=1,
        tail_count=1,
    )
    data.update(overrides)
    return CreatureSpec(**data)


def test_elemental_silhouettes_are_not_the_same_mesh():
    water = generate_quadruped(_spec(proportions={"length": 1.4, "bulk": 0.82, "leg": 0.78}))
    earth = generate_quadruped(_spec(proportions={"length": 0.88, "bulk": 1.4, "leg": 0.78}, spikes=3))
    water_z = max(p[2] for p in water.mesh.positions) - min(p[2] for p in water.mesh.positions)
    earth_z = max(p[2] for p in earth.mesh.positions) - min(p[2] for p in earth.mesh.positions)
    water_x = max(p[0] for p in water.mesh.positions) - min(p[0] for p in water.mesh.positions)
    earth_x = max(p[0] for p in earth.mesh.positions) - min(p[0] for p in earth.mesh.positions)
    assert water_z > earth_z * 1.15
    assert earth_x > water_x * 1.1
    assert len(earth.mesh.parts) > len(water.mesh.parts)


def test_control_mesh_is_closed_quads():
    generated = generate_quadruped(_spec())
    mesh = generated.mesh
    boundary, nonmanifold = boundary_and_nonmanifold(mesh)
    assert boundary == []
    assert nonmanifold == []
    assert degenerate_quads(mesh) == []
    assert signed_volume(mesh) > 0.0
    assert mesh.triangle_count > 400


def test_feet_are_on_the_ground_and_sides_are_opposite():
    generated = generate_quadruped(_spec())
    ys = [float(point[1]) for point in generated.mesh.positions]
    assert min(ys) == 0.0
    assert generated.landmarks["thigh_fl"][0] < -0.05
    assert generated.landmarks["thigh_fr"][0] > 0.05
    assert generated.landmarks["thigh_hl"][0] < -0.05
    assert generated.landmarks["thigh_hr"][0] > 0.05
    assert generated.landmarks["head"][2] > generated.landmarks["pelvis"][2]
    assert generated.landmarks["tail_04"][2] < generated.landmarks["pelvis"][2]


def test_weights_are_normalized():
    generated = generate_quadruped(_spec())
    for weights in generated.mesh.weights:
        assert weights
        assert abs(sum(weights.values()) - 1.0) < 1e-5
        assert all(value > 0 for value in weights.values())
        assert len(weights) <= 4


def test_subdivision_stays_closed():
    generated = generate_quadruped(_spec())
    refined = subdivide_times(generated.mesh, 1)
    boundary, nonmanifold = boundary_and_nonmanifold(refined)
    assert boundary == []
    assert nonmanifold == []
    assert refined.triangle_count == generated.mesh.triangle_count * 4
    assert signed_volume(refined) > 0.0


def test_uvs_stay_inside_the_unit_square():
    generated = generate_quadruped(_spec())
    for face in generated.mesh.uvs:
        assert len(face) == 4
        for u_coord, v_coord in face:
            assert 0.0 <= u_coord <= 1.0
            assert 0.0 <= v_coord <= 1.0
