"""Validated descriptive image output, without identity matching fields."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class VisionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PersonDescription(VisionOutput):
    position: str = Field(max_length=150)
    action: str = Field(max_length=200)
    distinctive_features: list[str] = Field(max_length=10)
    confidence: Literal["low", "medium", "high"]


class Conditions(VisionOutput):
    wave_size: str | None = Field(max_length=150)
    weather: str | None = Field(max_length=150)
    location_hints: list[str] = Field(max_length=5)


class PhotoAnalysis(VisionOutput):
    people_count: int = Field(ge=0, le=100)
    people: list[PersonDescription] = Field(max_length=100)
    conditions: Conditions
    overall_description: str = Field(max_length=2000)
    visual_tags: list[str] = Field(max_length=20)

    @model_validator(mode="after")
    def consistent_count(self):
        if self.people_count != len(self.people):
            raise ValueError("People count must match descriptions")
        return self


class BoardAnalysis(VisionOutput):
    board_detected: bool
    brand: str | None = Field(max_length=100)
    model: str | None = Field(max_length=100)
    board_type: str | None = Field(max_length=50)
    fin_setup: str | None = Field(max_length=50)
    tail_shape: str | None = Field(max_length=50)
    visible_text: list[str] = Field(max_length=10)
    description: str = Field(max_length=2000)
    confidence: Literal["low", "medium", "high"]

    @model_validator(mode="after")
    def no_board_no_attributes(self):
        if not self.board_detected and any(getattr(self, k) is not None for k in
                                           ("brand", "model", "board_type", "fin_setup", "tail_shape")):
            raise ValueError("Cannot describe an absent board")
        return self


class HeldBoardObservation(VisionOutput):
    """Image-only equipment facts, associated with a position rather than an identity."""
    person_index: int = Field(ge=0, le=99)
    relationship: Literal["holding", "riding", "nearby", "unknown"]
    colors: list[Literal["white", "black", "blue", "red", "green", "yellow", "orange",
                         "pink", "purple", "brown", "grey"]] = Field(max_length=6)
    patterns: list[Literal["stripes", "checkerboard", "flames", "wood grain", "gradient"]] = Field(max_length=5)
    visible_text: list[str] = Field(max_length=8)
    board_type: str | None = Field(max_length=50)
    fin_setup: str | None = Field(max_length=50)
    tail_shape: str | None = Field(max_length=50)
    confidence: Literal["low", "medium", "high"]


class BoardCluePhotoAnalysis(PhotoAnalysis):
    board_observations: list[HeldBoardObservation] = Field(max_length=8)

    @model_validator(mode="after")
    def observed_person_exists(self):
        if any(b.person_index >= len(self.people) for b in self.board_observations):
            raise ValueError("Board observation must reference a described person")
        if any(len(text) > 100 for b in self.board_observations for text in b.visible_text):
            raise ValueError("Board labels must be short")
        return self
