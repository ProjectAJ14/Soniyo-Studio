"""Static catalogue and built-in presets. Pure data."""

from .schemas import BuilderSpec, Catalog


def build_catalog(*, lm_cap_seconds: int) -> Catalog:
    raise NotImplementedError


# (stable_id, name, spec) — seeded into the presets table as builtin rows on startup.
BUILTIN_PRESETS: list[tuple[str, str, BuilderSpec]] = []
