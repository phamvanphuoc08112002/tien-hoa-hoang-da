"""Creature specification models."""

from __future__ import annotations

import re
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ARCHETYPES = ("quadruped", "biped", "winged", "insectoid", "serpentine", "aquatic", "hybrid")
Archetype = Literal["quadruped", "biped", "winged", "insectoid", "serpentine", "aquatic", "hybrid"]
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "creature"


def new_creature_id(species: str, archetype: str) -> str:
    return f"CR-{archetype}-{slugify(species)}-{uuid.uuid4().hex[:8]}"


class CreatureSpec(BaseModel):
    creature_id: str | None = None
    species: str = "Emberback"
    archetype: Archetype = "quadruped"
    body_structure: str = "sturdy"
    leg_count: int = 4
    head_count: int = 1
    tail_count: int = 1
    wing_count: int = 0
    extra_limbs: int = 0
    proportions: dict[str, float] = Field(default_factory=dict)
    surface_material: str = "scales"
    palette: list[str] = Field(default_factory=lambda: ["#8C3A2F", "#E3A008", "#2B2118", "#F4E1C1"])
    horns: int = 2
    spikes: int = 0
    armor: str = "none"
    accessories: list[str] = Field(default_factory=list)
    element: str = "fire"
    rarity: str = "rare"
    visual_complexity: str = "medium"
    prompt: str = "Stylized sturdy quadruped with a long tail, two horns, and scaled hide. No wings."
    style: str = "stylized_aaa"
    category: str = "beast"
    quality_profile: str | None = None

    @field_validator("species")
    @classmethod
    def species_not_empty(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("species is required")
        return text[:48]

    @field_validator("palette")
    @classmethod
    def palette_hex(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("palette needs at least one color")
        cleaned = []
        for color in value[:6]:
            if not HEX_COLOR.match(color):
                raise ValueError(f"palette color must be #RRGGBB, got {color}")
            cleaned.append(color.upper())
        return cleaned

    @field_validator("horns", "spikes", "leg_count", "head_count", "tail_count", "wing_count", "extra_limbs")
    @classmethod
    def non_negative(cls, value: int) -> int:
        if value < 0 or value > 12:
            raise ValueError("counts must be between 0 and 12")
        return value

    def ensure_id(self) -> str:
        if not self.creature_id:
            self.creature_id = new_creature_id(self.species, self.archetype)
        return self.creature_id


def elemental_roster(profile: str = "stylized_aaa") -> list[CreatureSpec]:
    """Six elemental quadrupeds. Same skeleton family, different silhouette and palette."""
    rows = [
        ("CR-quadruped-moc-long", "Moc Long", "wood", "sturdy", ["#6FAE45", "#3B6A2C", "#A9DA6C", "#EFE4B4"], 2, 2, {"length": 1.05, "bulk": 1.18, "height": 1.05, "leg": 0.9, "horn": 1.15}, "Rồng rừng bốn chân, thân dày, sừng gỗ, gai lưng ngắn."),
        ("CR-quadruped-hoa-long", "Hoa Long", "fire", "lean", ["#E0662A", "#9A361B", "#FFA457", "#FFE2B4"], 2, 4, {"length": 1.12, "bulk": 0.92, "height": 1.08, "leg": 1.08, "horn": 1.35}, "Rồng lửa bốn chân, mõm dài, gai lưng và sừng sắc."),
        ("CR-quadruped-thuy-long", "Thuy Long", "water", "long", ["#46A3DA", "#2A67A0", "#93D8F6", "#E8F6FF"], 2, 1, {"length": 1.4, "bulk": 0.82, "height": 0.92, "leg": 0.78, "horn": 0.9}, "Rồng nước thân dài, bụng sáng, chân thấp."),
        ("CR-quadruped-phong-long", "Phong Long", "wind", "slender", ["#8EC8E8", "#4A7A9A", "#D4F0FF", "#F4FBFF"], 2, 0, {"length": 1.18, "bulk": 0.7, "height": 1.12, "leg": 1.28, "horn": 1.05}, "Rồng gió thân mảnh, chân cao, không gai lưng."),
        ("CR-quadruped-loi-long", "Loi Long", "lightning", "lean", ["#C8A0FF", "#6A3AA0", "#FFE066", "#FFF4C8"], 2, 4, {"length": 1.02, "bulk": 0.88, "height": 1.1, "leg": 1.12, "horn": 1.45}, "Rồng sét gai dày, sừng cao, thân gọn."),
        ("CR-quadruped-tho-long", "Tho Long", "earth", "heavy", ["#B89058", "#6A4A28", "#E0C090", "#EFE0C0"], 2, 3, {"length": 0.88, "bulk": 1.4, "height": 0.95, "leg": 0.78, "horn": 1.2}, "Rồng đá thân nặng, vai rộng, chân ngắn."),
    ]
    specs = []
    for creature_id, species, element, body, palette, horns, spikes, proportions, prompt in rows:
        specs.append(
            CreatureSpec(
                creature_id=creature_id,
                species=species,
                archetype="quadruped",
                body_structure=body,
                leg_count=4,
                head_count=1,
                tail_count=1,
                wing_count=0,
                extra_limbs=0,
                proportions=proportions,
                surface_material="scales",
                palette=palette,
                horns=horns,
                spikes=spikes,
                armor="plates" if element == "earth" else "none",
                accessories=[],
                element=element,
                rarity="rare",
                visual_complexity="medium",
                prompt=prompt,
                style="stylized_aaa",
                category="dragon",
                quality_profile=profile,
            )
        )
    return specs


def hero_type1(profile: str = "hero_stylized") -> CreatureSpec:
    """Fantasy RPG hero — asset pack type 1 from the character design sheet."""
    return CreatureSpec(
        creature_id="CR-biped-hero-type1",
        species="Hero Type1",
        archetype="biped",
        body_structure="athletic",
        leg_count=2,
        head_count=1,
        tail_count=0,
        wing_count=0,
        extra_limbs=0,
        proportions={"body_scale": 1.0, "bulk": 1.0},
        surface_material="skin",
        palette=["#3B6FDB", "#F2C7A4", "#6B3E2E", "#F5F0E6", "#D4A017", "#8B5A2B"],
        horns=0,
        spikes=0,
        armor="leather",
        accessories=["cape", "crystal_sword", "boots", "belt"],
        element="light",
        rarity="legendary",
        visual_complexity="high",
        prompt=(
            "Stylized 3D fantasy RPG hero. Young male adventurer, messy brown hair, large eyes, "
            "blue-white tunic with leather straps and gold trim, blue cape with gold emblem, "
            "brown boots, crystal blue sword. Bright fantasy colors, recognizable all-ages design."
        ),
        style="stylized_aaa",
        category="hero",
        quality_profile=profile,
    )


def sample_emberback(profile: str = "stylized_aaa") -> CreatureSpec:
    return CreatureSpec(
        creature_id="CR-quadruped-emberback-sample",
        species="Emberback",
        archetype="quadruped",
        body_structure="sturdy",
        leg_count=4,
        head_count=1,
        tail_count=1,
        wing_count=0,
        extra_limbs=0,
        proportions={"body_scale": 1.0},
        surface_material="scales",
        palette=["#8C3A2F", "#C4622D", "#E3A008", "#F4E1C1"],
        horns=2,
        spikes=0,
        armor="none",
        accessories=[],
        element="fire",
        rarity="rare",
        visual_complexity="medium",
        prompt="A stylized quadrupedal ember-backed beast. Four legs, one horned head, one long tail, no wings.",
        style="stylized_aaa",
        category="beast",
        quality_profile=profile,
    )
