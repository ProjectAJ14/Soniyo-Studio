"""Builder spec → engine caption and parameters. Pure: no I/O, no settings object."""

from .schemas import BuilderSpec, CompileResult, EngineParams, Instrument, Plan, Routing

DEFAULT_LM_TEMPERATURE = 0.85
REPEAT_NOTE = (
    "Repetition count is approximate in a single pass; exact counts arrive with loop mode."
)

_VOCAL_TYPE = {
    "female": "female vocal",
    "male": "male vocal",
    "duet": "male and female duet vocals",
    "choir": "choir vocals",
}
_DELIVERY = {"sing": "melodic singing", "hum": "gentle humming"}
_LEVEL = {"very soft": "very soft", "soft": "subtle", "present": "", "prominent": "prominent"}
_FREQUENCY = {"rare": "rare", "occasional": "occasional", "regular": "frequent"}
_SPACE = {"intimate": "intimate", "room": "warm room", "hall": "grand hall", "spacious": "spacious"}
_ACCENT_LEVEL = {"very soft": "faint", "soft": "delicate", "present": "", "prominent": "bold"}
_REVERB = {
    "dry": "dry mix",
    "light": "light reverb",
    "medium": "medium reverb",
    "deep": "deep reverb",
}
# Positive phrasing only: negations in the caption can pull toward the named thing (PRD risks).
_DYNAMICS = {
    "steady": "gentle consistent rhythm",
    "gentle swells": "gentle swells",
    "building": "gradually building intensity",
}


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        item = item.strip()
        if item and item.lower() not in seen:
            seen.add(item.lower())
            out.append(item)
    return out


def _words(parts: list[str], last: str = " and ") -> str:
    """["a"] → "a"; ["a", "b", "c"] → "a, b and c"."""
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + last + parts[-1]


def _instrument(inst: Instrument) -> str:
    name = inst.name.strip()
    if inst.role == "accent":
        words = [_FREQUENCY[inst.frequency or "occasional"], _ACCENT_LEVEL[inst.level], name]
    elif inst.role == "drone":
        words = [_LEVEL[inst.level], name if "drone" in name.lower() else f"{name} drone"]
    elif inst.role == "lead":
        words = [_LEVEL[inst.level], "lead", name]
    elif inst.role == "background":
        words = [_LEVEL[inst.level], name, "in the background"]
    else:
        words = [_LEVEL[inst.level], name]
    return " ".join(w for w in words if w)


def _vocal_phrases(spec: BuilderSpec) -> list[str]:
    v = spec.vocals
    if v.type == "none":
        return ["instrumental, no vocals"]  # the one allowed negation: it is the instruction itself
    chars = _dedupe(v.character)
    devotional = "devotional" if spec.theme.deity or "devotional" in spec.moods else ""
    lead = " ".join(w for w in [chars[0] if chars else "", devotional, _VOCAL_TYPE[v.type]] if w)
    phrases = [lead]
    if chars[1:]:
        phrases.append(f"{_words(chars[1:])} voice")
    if v.delivery == "chant":
        slow = spec.music.bpm is None or spec.music.bpm <= 80
        phrases.append("slow chanting" if slow else "rhythmic chanting")
    elif v.delivery:
        phrases.append(_DELIVERY[v.delivery])
    return phrases


def _caption(spec: BuilderSpec) -> str:
    parts = [spec.style]
    so_far = spec.style.lower()
    theme = [p.strip() for p in (spec.theme.deity, spec.theme.form) if p and p.strip()]
    parts.append(" ".join(p for p in theme if p.lower() not in so_far))
    parts += _vocal_phrases(spec)
    parts.append(spec.vocals.notes)
    if spec.music.bpm is not None:
        parts.append(f"{spec.music.bpm} BPM")
    parts += [_instrument(i) for i in spec.instruments]
    spiritual = "spiritual " if spec.theme.deity else ""
    parts += [
        f"{_SPACE[spec.ambience.space]} {spiritual}ambience",
        _REVERB[spec.ambience.reverb],
        _DYNAMICS[spec.ambience.dynamics],
    ]
    moods = _dedupe(spec.moods)
    if moods:
        parts.append(f"{_words(moods)} atmosphere")
    return ", ".join(_dedupe(parts))


def _lyrics(spec: BuilderSpec) -> str:
    text = spec.lyrics.text.strip()
    if not text:
        return "[Instrumental]" if spec.vocals.type == "none" else ""
    return "\n".join([text] * (spec.lyrics.repeat or 1))


def _mmss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def compile_spec(spec: BuilderSpec, *, lm_cap_seconds: int) -> CompileResult:
    eng = spec.engine
    caption = eng.caption_override if eng.caption_override is not None else _caption(spec)
    avoid = _dedupe(spec.avoid)
    negative = ", ".join(avoid)
    lyrics = _lyrics(spec)
    total = spec.length.total_seconds
    notes: list[str] = []

    split = eng.lm != "off" and total > lm_cap_seconds
    thinking = eng.lm != "off" and not split
    if split:
        notes.append(
            f"Above this Mac's {_mmss(lm_cap_seconds)} LM cap: lyrics and metadata are planned "
            "first, then rendered with the LM off."
        )
    if spec.lyrics.repeat is not None:
        notes.append(REPEAT_NOTE)

    params = EngineParams(
        prompt=caption,
        lyrics=lyrics,
        lm_negative_prompt=negative,
        bpm=spec.music.bpm,
        key_scale=spec.music.key or "",
        time_signature=spec.music.time_signature or "",  # "" = Auto: the LM/engine picks
        audio_duration=total,
        vocal_language="unknown" if spec.vocals.type == "none" else spec.vocals.language or "",
        thinking=thinking,
        use_cot_caption=not eng.keep_caption,
        seed=-1 if eng.seed is None else eng.seed,
        lm_temperature=(
            DEFAULT_LM_TEMPERATURE if eng.lm_temperature is None else eng.lm_temperature
        ),
    )
    return CompileResult(
        caption=caption,
        lyrics=lyrics,
        negative_prompt=negative,
        params=params,
        plan=Plan(lm_text_pass=split, lm_off_render=not thinking, lm_cap_seconds=lm_cap_seconds),
        routing=[Routing(item=a, target="lm_negative_prompt") for a in avoid],
        notes=notes,
    )
