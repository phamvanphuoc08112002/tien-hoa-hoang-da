"""Skeleton templates. Archetypes do not share a bone hierarchy."""

from __future__ import annotations

Bone = tuple[str, str | None]

QUADRUPED_BONES: list[Bone] = [
    ("root", None),
    ("pelvis", "root"),
    ("spine_01", "pelvis"),
    ("spine_02", "spine_01"),
    ("spine_03", "spine_02"),
    ("neck_01", "spine_03"),
    ("head", "neck_01"),
    ("tail_01", "pelvis"),
    ("tail_02", "tail_01"),
    ("tail_03", "tail_02"),
    ("tail_04", "tail_03"),
    ("thigh_fl", "spine_03"),
    ("shin_fl", "thigh_fl"),
    ("foot_fl", "shin_fl"),
    ("toe_fl", "foot_fl"),
    ("thigh_fr", "spine_03"),
    ("shin_fr", "thigh_fr"),
    ("foot_fr", "shin_fr"),
    ("toe_fr", "foot_fr"),
    ("thigh_hl", "pelvis"),
    ("shin_hl", "thigh_hl"),
    ("foot_hl", "shin_hl"),
    ("toe_hl", "foot_hl"),
    ("thigh_hr", "pelvis"),
    ("shin_hr", "thigh_hr"),
    ("foot_hr", "shin_hr"),
    ("toe_hr", "foot_hr"),
]

BIPED_BONES: list[Bone] = [
    ("root", None),
    ("pelvis", "root"),
    ("spine_01", "pelvis"),
    ("spine_02", "spine_01"),
    ("chest", "spine_02"),
    ("neck_01", "chest"),
    ("head", "neck_01"),
    ("clavicle_l", "chest"),
    ("upperarm_l", "clavicle_l"),
    ("forearm_l", "upperarm_l"),
    ("hand_l", "forearm_l"),
    ("clavicle_r", "chest"),
    ("upperarm_r", "clavicle_r"),
    ("forearm_r", "upperarm_r"),
    ("hand_r", "forearm_r"),
    ("weapon_r", "hand_r"),
    ("thigh_l", "pelvis"),
    ("calf_l", "thigh_l"),
    ("foot_l", "calf_l"),
    ("toe_l", "foot_l"),
    ("thigh_r", "pelvis"),
    ("calf_r", "thigh_r"),
    ("foot_r", "calf_r"),
    ("toe_r", "foot_r"),
    ("cape_01", "chest"),
    ("cape_02", "cape_01"),
]

WINGED_BONES: list[Bone] = [
    ("root", None),
    ("pelvis", "root"),
    ("spine_01", "pelvis"),
    ("spine_02", "spine_01"),
    ("chest", "spine_02"),
    ("neck_01", "chest"),
    ("head", "neck_01"),
    ("wing_arm_l", "chest"),
    ("wing_forearm_l", "wing_arm_l"),
    ("wing_hand_l", "wing_forearm_l"),
    ("wing_arm_r", "chest"),
    ("wing_forearm_r", "wing_arm_r"),
    ("wing_hand_r", "wing_forearm_r"),
    ("thigh_l", "pelvis"),
    ("shin_l", "thigh_l"),
    ("foot_l", "shin_l"),
    ("thigh_r", "pelvis"),
    ("shin_r", "thigh_r"),
    ("foot_r", "shin_r"),
    ("tail_01", "pelvis"),
]

INSECTOID_BONES: list[Bone] = [
    ("root", None),
    ("thorax", "root"),
    ("abdomen_01", "thorax"),
    ("abdomen_02", "abdomen_01"),
    ("head", "thorax"),
    ("femur_1", "thorax"),
    ("tibia_1", "femur_1"),
    ("femur_2", "thorax"),
    ("tibia_2", "femur_2"),
    ("femur_3", "thorax"),
    ("tibia_3", "femur_3"),
    ("femur_4", "thorax"),
    ("tibia_4", "femur_4"),
    ("femur_5", "abdomen_01"),
    ("tibia_5", "femur_5"),
    ("femur_6", "abdomen_01"),
    ("tibia_6", "femur_6"),
]

SERPENTINE_BONES: list[Bone] = [("root", None), ("spine_01", "root")] + [
    (f"spine_{index:02d}", f"spine_{index - 1:02d}") for index in range(2, 13)
] + [("head", "spine_12")]

AQUATIC_BONES: list[Bone] = [
    ("root", None),
    ("body_01", "root"),
    ("body_02", "body_01"),
    ("body_03", "body_02"),
    ("neck_01", "body_03"),
    ("head", "neck_01"),
    ("pectoral_l", "body_02"),
    ("pectoral_r", "body_02"),
    ("dorsal_fin", "body_02"),
    ("tail_01", "body_01"),
    ("tail_fluke", "tail_01"),
]

HYBRID_BONES: list[Bone] = [
    ("root", None),
    ("core", "root"),
    ("neck_01", "core"),
    ("head", "neck_01"),
    ("limb_a_01", "core"),
    ("limb_a_02", "limb_a_01"),
    ("limb_b_01", "core"),
    ("limb_b_02", "limb_b_01"),
    ("extra_jaw", "head"),
    ("tail_01", "core"),
]

ARCHETYPE_BONES: dict[str, list[Bone]] = {
    "quadruped": QUADRUPED_BONES,
    "biped": BIPED_BONES,
    "winged": WINGED_BONES,
    "insectoid": INSECTOID_BONES,
    "serpentine": SERPENTINE_BONES,
    "aquatic": AQUATIC_BONES,
    "hybrid": HYBRID_BONES,
}

QUADRUPED_REQUIRED = [name for name, _parent in QUADRUPED_BONES]
BIPED_REQUIRED = [name for name, _parent in BIPED_BONES]


def bones_as_json(bones: list[Bone]) -> list[dict[str, str | None]]:
    return [{"name": name, "parent": parent} for name, parent in bones]


def validate_hierarchy(bones: list[Bone]) -> list[str]:
    errors = []
    names = [name for name, _parent in bones]
    if len(names) != len(set(names)):
        errors.append("duplicate bone names")
    parents = dict(bones)
    if parents.get("root") is not None:
        errors.append("root must have no parent")
    roots = [name for name, parent in bones if parent is None]
    if roots != ["root"]:
        errors.append(f"expected a single root, found {roots}")
    for name, parent in bones:
        if parent is None:
            continue
        if parent not in parents:
            errors.append(f"{name} parent {parent} is missing")
        seen = set()
        cursor: str | None = name
        while cursor is not None:
            if cursor in seen:
                errors.append(f"cycle at {name}")
                break
            seen.add(cursor)
            cursor = parents.get(cursor)
    return errors
