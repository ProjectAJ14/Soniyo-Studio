from soniyo_gateway.catalog import BUILTIN_PRESETS
from soniyo_gateway.compiler import REPEAT_NOTE, compile_spec
from soniyo_gateway.schemas import BuilderSpec

CAP = 480


def shiva() -> BuilderSpec:
    return next(s for pid, _, s in BUILTIN_PRESETS if pid == "builtin-shiva-mantra")


def test_shiva_preset_matches_prd_caption():
    r = compile_spec(shiva(), lm_cap_seconds=CAP)
    for phrase in [
        "Deeply peaceful Shiva mantra meditation",
        "soft devotional female vocal",
        "warm and soothing voice",
        "slow chanting",
        "clear Sanskrit and Hindi pronunciation",
        "60 BPM",
        "gentle consistent rhythm",
        "tanpura drone",
        "subtle shruti box",
        "very soft bansuri in the background",
        "occasional delicate temple bell",
        "spacious spiritual ambience",
        "deep reverb",
        "calm, devotional and serene atmosphere",
    ]:
        assert phrase in r.caption, phrase
    assert r.caption.index("slow chanting") < r.caption.index("60 BPM") < r.caption.index("tanpura")
    assert " no " not in f" {r.caption.lower()} "
    assert "EDM" not in r.caption
    assert r.params.bpm == 60 and r.params.audio_duration == 600
    assert r.params.prompt == r.caption and r.params.vocal_language == "sa"
    assert r.params.use_cot_caption is False and r.params.seed == -1
    assert r.params.lm_temperature == 0.85 and r.params.time_signature == "4"
    assert r.params.key_scale == ""
    assert r.plan.lm_text_pass and r.plan.lm_off_render and not r.params.thinking
    assert r.plan.lm_cap_seconds == CAP
    assert r.lyrics.split("\n") == ["ॐ नमः शिवाय"] * 108
    assert r.negative_prompt.startswith("dramatic buildup, pop chorus")
    assert r.params.lm_negative_prompt == r.negative_prompt
    assert {x.target for x in r.routing} == {"lm_negative_prompt"} and len(r.routing) == 6
    assert "Above this Mac's 8:00 LM cap" in r.notes[0] and REPEAT_NOTE in r.notes


def test_lm_modes():
    short = {"length": {"total_seconds": 300}}
    assert compile_spec(BuilderSpec.model_validate(short), lm_cap_seconds=CAP).params.thinking
    off = compile_spec(
        BuilderSpec.model_validate({**short, "engine": {"lm": "off"}}), lm_cap_seconds=CAP
    )
    assert not off.params.thinking and not off.plan.lm_text_pass and off.notes == []
    on_long = compile_spec(
        BuilderSpec.model_validate({"length": {"total_seconds": 600}, "engine": {"lm": "on"}}),
        lm_cap_seconds=450,
    )
    assert on_long.plan.lm_text_pass and not on_long.params.thinking
    assert "7:30 LM cap" in on_long.notes[0]


def test_instrumental():
    r = compile_spec(BuilderSpec.model_validate({"vocals": {"type": "none"}}), lm_cap_seconds=CAP)
    assert "instrumental, no vocals" in r.caption and "vocal," not in r.caption
    assert r.params.vocal_language == "unknown" and r.lyrics == "[Instrumental]"


def test_caption_override_is_verbatim():
    spec = shiva().model_copy(deep=True)
    spec.engine.caption_override = "  exactly this, no edits  "
    r = compile_spec(spec, lm_cap_seconds=CAP)
    assert r.caption == r.params.prompt == "  exactly this, no edits  "


def test_empty_spec_compiles():
    r = compile_spec(BuilderSpec.model_validate({}), lm_cap_seconds=CAP)
    assert r.caption and r.params.bpm is None and r.params.vocal_language == ""
    assert r.params.time_signature == ""  # Auto stays auto; the LM/engine decides
    assert r.params.audio_duration == 180 and r.lyrics == "" and r.notes == []


def test_dedupe_and_determinism():
    spec = BuilderSpec.model_validate({"moods": ["calm", "Calm"], "avoid": ["EDM", "edm", " "]})
    r = compile_spec(spec, lm_cap_seconds=CAP)
    assert r.negative_prompt == "EDM" and "calm atmosphere" in r.caption
    for _, _, s in BUILTIN_PRESETS:
        assert compile_spec(s, lm_cap_seconds=CAP) == compile_spec(s, lm_cap_seconds=CAP)
