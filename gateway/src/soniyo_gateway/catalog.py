"""Static catalogue and built-in presets. Pure data."""

from typing import get_args

from .schemas import (
    BuilderSpec,
    Catalog,
    CatalogInstrument,
    Delivery,
    Dynamics,
    Frequency,
    Language,
    Level,
    Reverb,
    Role,
    Space,
    VocalType,
)

# (name, default_role, tags)
_INSTRUMENTS: list[tuple[str, Role, list[str]]] = [
    # Indian classical and devotional
    ("tanpura", "drone", ["indian", "drone", "strings"]),
    ("shruti box", "drone", ["indian", "drone", "reed"]),
    ("harmonium", "supporting", ["indian", "reed", "keys"]),
    ("bansuri", "lead", ["indian", "wind", "flute"]),
    ("shehnai", "lead", ["indian", "wind"]),
    ("sitar", "lead", ["indian", "strings", "plucked"]),
    ("sarod", "lead", ["indian", "strings", "plucked"]),
    ("veena", "lead", ["indian", "strings", "plucked"]),
    ("santoor", "supporting", ["indian", "strings", "hammered"]),
    ("sarangi", "lead", ["indian", "strings", "bowed"]),
    ("tabla", "supporting", ["indian", "percussion"]),
    ("mridangam", "supporting", ["indian", "percussion"]),
    ("pakhawaj", "supporting", ["indian", "percussion"]),
    ("dholak", "supporting", ["indian", "percussion", "folk"]),
    ("dhol", "supporting", ["indian", "percussion", "folk"]),
    ("manjira", "accent", ["indian", "percussion", "cymbals"]),
    ("kartal", "accent", ["indian", "percussion", "clappers"]),
    ("temple bell", "accent", ["indian", "bell", "ritual"]),
    ("ghanta", "accent", ["indian", "bell", "ritual"]),
    ("conch", "accent", ["indian", "wind", "ritual"]),
    ("damaru", "accent", ["indian", "percussion", "ritual"]),
    # Western and global
    ("piano", "supporting", ["western", "keys"]),
    ("electric piano", "supporting", ["western", "keys"]),
    ("string ensemble", "supporting", ["western", "strings", "orchestral"]),
    ("violin", "lead", ["western", "strings", "bowed"]),
    ("cello", "supporting", ["western", "strings", "bowed"]),
    ("acoustic guitar", "supporting", ["western", "strings", "plucked"]),
    ("harp", "supporting", ["western", "strings", "plucked"]),
    ("flute", "lead", ["western", "wind"]),
    ("oud", "lead", ["global", "strings", "plucked"]),
    ("frame drum", "supporting", ["global", "percussion"]),
    ("handpan", "lead", ["global", "percussion", "melodic"]),
    ("kalimba", "supporting", ["global", "percussion", "melodic"]),
    ("singing bowl", "accent", ["global", "bell", "meditation"]),
    ("wind chimes", "accent", ["global", "bell", "ambient"]),
    ("synth pad", "background", ["electronic", "pad", "ambient"]),
    ("choir pad", "background", ["pad", "vocal", "ambient"]),
    ("sub bass", "supporting", ["electronic", "bass"]),
    ("rain ambience", "background", ["ambient", "nature"]),
    ("river ambience", "background", ["ambient", "nature"]),
    ("birdsong", "background", ["ambient", "nature"]),
]

# ACE-Step language codes most useful here; the engine supports more.
_LANGUAGES = [
    ("sa", "Sanskrit"), ("hi", "Hindi"), ("en", "English"), ("ta", "Tamil"),
    ("te", "Telugu"), ("bn", "Bengali"), ("mr", "Marathi"), ("pa", "Punjabi"),
    ("gu", "Gujarati"), ("ja", "Japanese"), ("zh", "Chinese"), ("ko", "Korean"),
    ("es", "Spanish"), ("fr", "French"), ("de", "German"), ("it", "Italian"),
    ("pt", "Portuguese"), ("ru", "Russian"),
]  # fmt: skip

_ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def build_catalog(*, lm_cap_seconds: int) -> Catalog:
    return Catalog(
        instruments=[CatalogInstrument(name=n, default_role=r, tags=t) for n, r, t in _INSTRUMENTS],
        roles=list(get_args(Role)),
        levels=list(get_args(Level)),
        frequencies=list(get_args(Frequency)),
        vocal_types=list(get_args(VocalType)),
        vocal_characters=[
            "soft", "warm", "soothing", "breathy", "clear", "bright", "deep",
            "powerful", "gentle", "resonant", "joyful",
        ],  # fmt: skip
        vocal_deliveries=list(get_args(Delivery)),
        languages=[Language(code=c, name=n) for c, n in _LANGUAGES],
        moods=[
            "meditative", "devotional", "calm", "uplifting", "serene", "peaceful",
            "joyful", "energetic", "powerful", "mystical", "festive", "melancholic",
            "romantic", "triumphant",
        ],  # fmt: skip
        deities=[
            "Shiva", "Krishna", "Ganesha", "Durga", "Hanuman", "Rama", "Vishnu",
            "Lakshmi", "Saraswati", "Kali",
        ],  # fmt: skip
        forms=[
            "bhajan", "aarti", "kirtan", "stotram", "chant", "mantra chant", "dhun", "meditation",
        ],  # fmt: skip
        avoid_chips=[
            "EDM", "heavy percussion", "pop chorus", "cinematic climax", "dramatic buildup",
            "Bollywood style", "electronic beats", "distorted guitar", "autotune", "rap",
        ],  # fmt: skip
        reverbs=list(get_args(Reverb)),
        spaces=list(get_args(Space)),
        dynamics=list(get_args(Dynamics)),
        keys=[f"{root} {mode}" for root in _ROOTS for mode in ("major", "minor")],
        time_signatures=["2", "3", "4", "6"],
        lm_cap_seconds=lm_cap_seconds,
    )


# (stable_id, name, spec) — seeded into the presets table as builtin rows on startup.
BUILTIN_PRESETS: list[tuple[str, str, BuilderSpec]] = [
    (
        "builtin-shiva-mantra",
        "Shiva mantra meditation",
        BuilderSpec.model_validate({
            "title": "Om Namah Shivaya",
            "theme": {"deity": "Shiva", "form": "mantra chant"},
            "style": "Deeply peaceful Shiva mantra meditation",
            "moods": ["calm", "devotional", "serene"],
            "vocals": {
                "type": "female",
                "character": ["soft", "warm", "soothing"],
                "delivery": "chant",
                "notes": "clear Sanskrit and Hindi pronunciation",
                "language": "sa",
            },
            "instruments": [
                {"name": "tanpura", "role": "drone", "level": "present"},
                {"name": "shruti box", "role": "supporting", "level": "soft"},
                {"name": "bansuri", "role": "background", "level": "very soft"},
                {"name": "temple bell", "role": "accent", "level": "soft",
                 "frequency": "occasional"},
            ],
            "ambience": {"reverb": "deep", "space": "spacious", "dynamics": "steady"},
            "avoid": ["dramatic buildup", "pop chorus", "Bollywood style", "EDM",
                      "heavy percussion", "cinematic climax"],
            "music": {"bpm": 60, "key": None, "time_signature": "4"},
            "lyrics": {"text": "ॐ नमः शिवाय", "repeat": 108},
            "length": {"mode": "single", "total_seconds": 600},
            "engine": {"lm": "auto", "keep_caption": True, "seed": None},
        }),
    ),
    (
        "builtin-krishna-bhajan",
        "Upbeat Krishna bhajan",
        BuilderSpec.model_validate({
            "title": "Hare Krishna",
            "theme": {"deity": "Krishna", "form": "bhajan"},
            "style": "Joyful, upbeat Krishna bhajan with a lively folk groove",
            "moods": ["joyful", "devotional", "festive"],
            "vocals": {
                "type": "male",
                "character": ["warm", "joyful"],
                "delivery": "sing",
                "notes": "call-and-response with a devotional choir",
                "language": "hi",
            },
            "instruments": [
                {"name": "harmonium", "role": "lead", "level": "present"},
                {"name": "dholak", "role": "supporting", "level": "prominent"},
                {"name": "kartal", "role": "accent", "level": "present", "frequency": "regular"},
                {"name": "bansuri", "role": "supporting", "level": "soft"},
            ],
            "ambience": {"reverb": "light", "space": "room", "dynamics": "gentle swells"},
            "avoid": ["EDM", "autotune", "distorted guitar"],
            "music": {"bpm": 112, "key": "D major", "time_signature": "4"},
            "lyrics": {
                "text": "[chorus]\nहरे कृष्ण हरे कृष्ण कृष्ण कृष्ण हरे हरे\nहरे राम हरे राम राम राम हरे हरे",
                "repeat": 16,
            },
            "length": {"mode": "single", "total_seconds": 300},
            "engine": {"lm": "auto", "keep_caption": False, "seed": None},
        }),
    ),
    (
        "builtin-ganesha-aarti",
        "Ganesha aarti",
        BuilderSpec.model_validate({
            "title": "Jai Ganesh Deva",
            "theme": {"deity": "Ganesha", "form": "aarti"},
            "style": "Traditional evening Ganesha aarti, bright and auspicious",
            "moods": ["devotional", "uplifting", "festive"],
            "vocals": {
                "type": "duet",
                "character": ["bright", "clear"],
                "delivery": "sing",
                "notes": "",
                "language": "hi",
            },
            "instruments": [
                {"name": "harmonium", "role": "supporting", "level": "present"},
                {"name": "tabla", "role": "supporting", "level": "present"},
                {"name": "manjira", "role": "accent", "level": "present", "frequency": "regular"},
                {"name": "ghanta", "role": "accent", "level": "soft", "frequency": "regular"},
                {"name": "conch", "role": "accent", "level": "prominent", "frequency": "rare"},
            ],
            "ambience": {"reverb": "medium", "space": "hall", "dynamics": "steady"},
            "avoid": ["EDM", "pop chorus", "rap"],
            "music": {"bpm": 90, "key": "G major", "time_signature": "4"},
            "lyrics": {"text": "जय गणेश जय गणेश जय गणेश देवा\nमाता जाकी पार्वती पिता महादेवा",
                       "repeat": 12},
            "length": {"mode": "single", "total_seconds": 300},
            "engine": {"lm": "auto", "keep_caption": False, "seed": None},
        }),
    ),
    (
        "builtin-durga-stotram",
        "Durga stotram",
        BuilderSpec.model_validate({
            "title": "Ya Devi Sarvabhuteshu",
            "theme": {"deity": "Durga", "form": "stotram"},
            "style": "Powerful Durga stotram, majestic and fierce",
            "moods": ["powerful", "devotional", "triumphant"],
            "vocals": {
                "type": "female",
                "character": ["powerful", "resonant"],
                "delivery": "chant",
                "notes": "precise Sanskrit diction",
                "language": "sa",
            },
            "instruments": [
                {"name": "tanpura", "role": "drone", "level": "soft"},
                {"name": "mridangam", "role": "supporting", "level": "prominent"},
                {"name": "string ensemble", "role": "supporting", "level": "present"},
                {"name": "veena", "role": "lead", "level": "present"},
                {"name": "conch", "role": "accent", "level": "prominent", "frequency": "rare"},
            ],
            "ambience": {"reverb": "medium", "space": "hall", "dynamics": "building"},
            "avoid": ["EDM", "pop chorus", "Bollywood style"],
            "music": {"bpm": 96, "key": "A minor", "time_signature": "4"},
            "lyrics": {
                "text": "या देवी सर्वभूतेषु शक्तिरूपेण संस्थिता।\nनमस्तस्यै नमस्तस्यै नमस्तस्यै नमो नमः॥",
                "repeat": 9,
            },
            "length": {"mode": "single", "total_seconds": 300},
            "engine": {"lm": "auto", "keep_caption": False, "seed": None},
        }),
    ),
    (
        "builtin-hanuman-kirtan",
        "Hanuman kirtan",
        BuilderSpec.model_validate({
            "title": "Shri Ram Jai Ram",
            "theme": {"deity": "Hanuman", "form": "kirtan"},
            "style": "Energetic Hanuman kirtan that speeds up like a temple gathering",
            "moods": ["energetic", "devotional", "joyful"],
            "vocals": {
                "type": "choir",
                "character": ["powerful", "joyful"],
                "delivery": "chant",
                "notes": "lead singer with group response",
                "language": "hi",
            },
            "instruments": [
                {"name": "harmonium", "role": "lead", "level": "present"},
                {"name": "dholak", "role": "supporting", "level": "prominent"},
                {"name": "manjira", "role": "accent", "level": "present", "frequency": "regular"},
                {"name": "kartal", "role": "accent", "level": "present", "frequency": "regular"},
            ],
            "ambience": {"reverb": "light", "space": "room", "dynamics": "building"},
            "avoid": ["EDM", "autotune", "cinematic climax"],
            "music": {"bpm": 120, "key": "E major", "time_signature": "4"},
            "lyrics": {"text": "श्री राम जय राम जय जय राम", "repeat": 40},
            "length": {"mode": "single", "total_seconds": 300},
            "engine": {"lm": "auto", "keep_caption": False, "seed": None},
        }),
    ),
    (
        "builtin-ambient-meditation",
        "Ambient meditation",
        BuilderSpec.model_validate({
            "title": "Still Water",
            "theme": {"deity": None, "form": "meditation"},
            "style": "Slow evolving ambient meditation soundscape",
            "moods": ["meditative", "peaceful", "mystical"],
            "vocals": {"type": "none", "character": [], "delivery": None, "notes": "",
                       "language": None},
            "instruments": [
                {"name": "synth pad", "role": "background", "level": "soft"},
                {"name": "handpan", "role": "lead", "level": "soft"},
                {"name": "singing bowl", "role": "accent", "level": "soft",
                 "frequency": "occasional"},
                {"name": "rain ambience", "role": "background", "level": "very soft"},
            ],
            "ambience": {"reverb": "deep", "space": "spacious", "dynamics": "gentle swells"},
            "avoid": ["heavy percussion", "EDM", "dramatic buildup"],
            "music": {"bpm": 50, "key": "F major", "time_signature": "4"},
            "lyrics": {"text": "", "repeat": None},
            "length": {"mode": "single", "total_seconds": 600},
            "engine": {"lm": "auto", "keep_caption": False, "seed": None},
        }),
    ),
]
