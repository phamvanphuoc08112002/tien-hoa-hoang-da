"""Type-1 humanoid hero mesh, rig, and pipeline checks."""

from creature_factory.anim.humanoid_clips import HUMANOID_CLIP_NAMES, build_humanoid_clips
from creature_factory.config import load_settings
from creature_factory.mesh import boundary_and_nonmanifold, degenerate_quads, lod_subdiv_level, signed_volume, subdivide_times
from creature_factory.mesh.humanoid import generate_humanoid
from creature_factory.pipeline.engine import execute_pipeline
from creature_factory.rig import BIPED_REQUIRED
from creature_factory.rig.skeleton import build_biped_skeleton
from creature_factory.specs import hero_type1


def test_humanoid_mesh_is_closed():
    generated = generate_humanoid(hero_type1("preview"))
    mesh = generated.mesh
    boundary, nonmanifold = boundary_and_nonmanifold(mesh)
    assert boundary == []
    assert nonmanifold == []
    assert degenerate_quads(mesh) == []
    assert signed_volume(mesh) > 0.0
    assert mesh.triangle_count > 400
    assert min(float(p[1]) for p in mesh.positions) == 0.0


def test_humanoid_landmarks_cover_biped_bones():
    generated = generate_humanoid(hero_type1("preview"))
    for bone in BIPED_REQUIRED:
        assert bone in generated.landmarks
    assert generated.landmarks["head"][1] > generated.landmarks["pelvis"][1]
    assert generated.landmarks["hand_r"][0] > 0.05
    assert generated.landmarks["hand_l"][0] < -0.05
    assert generated.landmarks["weapon_r"][2] > generated.landmarks["hand_r"][2]


def test_humanoid_clips_and_budget():
    generated = generate_humanoid(hero_type1("hero_stylized"))
    skeleton = build_biped_skeleton(generated.landmarks, generated.scale)
    clips = build_humanoid_clips(skeleton)
    assert list(clips) == list(HUMANOID_CLIP_NAMES)
    profile = load_settings().profile("hero_stylized")
    level = lod_subdiv_level(generated.mesh.triangle_count, profile["tri_min"], profile["tri_max"])
    hero = subdivide_times(generated.mesh, level)
    assert profile["tri_min"] <= hero.triangle_count <= profile["tri_max"]


def test_hero_type1_pipeline(tmp_path):
    settings = load_settings()
    settings.output_dir = tmp_path
    settings.database_path = tmp_path / "factory.sqlite"
    settings.quality_profile = "preview"
    spec = hero_type1("preview")
    result = execute_pipeline(spec, settings, "hero-preview")
    assert result["status"] == "completed", result
    assert result["quality_decision"] == "accept"
    folder = tmp_path / "creatures" / spec.creature_id
    assert (folder / "mesh" / "creature.gltf").is_file()
    assert (folder / "concept" / "concept.png").is_file()
    assert (folder / "animations" / "manifest.json").is_file()
    assert (folder / "rig" / "skeleton.json").is_file()
