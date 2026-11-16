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
