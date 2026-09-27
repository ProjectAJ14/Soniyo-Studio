from soniyo_gateway.catalog import BUILTIN_PRESETS, build_catalog
from soniyo_gateway.compiler import compile_spec


def test_catalog_contents():
    c = build_catalog(lm_cap_seconds=480)
    names = [i.name for i in c.instruments]
    assert len(names) == len(set(names))
    for n in ["tanpura", "shruti box", "bansuri", "sitar", "sarod", "santoor", "veena",
              "harmonium", "tabla", "mridangam", "dholak", "pakhawaj", "manjira", "kartal",
              "temple bell", "conch", "ghanta", "piano", "cello", "violin", "acoustic guitar",
              "flute", "synth pad", "choir pad", "handpan", "singing bowl", "rain ambience"]:
        assert n in names, n
    assert all(i.tags for i in c.instruments)
    codes = {lang.code for lang in c.languages}
    assert {"sa", "hi", "en", "ta", "te", "bn", "mr", "pa", "gu", "ja", "zh", "es", "fr"} <= codes
    assert len(c.keys) == 24 and c.keys[0] == "C major" and c.keys[-1] == "B minor"
    assert c.roles == ["drone", "lead", "supporting", "background", "accent"]
    assert c.vocal_types[0] == "none" and c.lm_cap_seconds == 480
    assert c.time_signatures == ["2", "3", "4", "6"]


def test_builtin_presets():
    ids = [pid for pid, _, _ in BUILTIN_PRESETS]
    assert 4 <= len(ids) <= 6 and len(ids) == len(set(ids))
    assert all(pid.startswith("builtin-") for pid in ids)
    assert "builtin-shiva-mantra" in ids
    known = {i.name for i in build_catalog(lm_cap_seconds=480).instruments}
    for _, name, spec in BUILTIN_PRESETS:
        assert name and spec.title
        assert {i.name for i in spec.instruments} <= known
        assert compile_spec(spec, lm_cap_seconds=480).caption
    assert any(s.vocals.type == "none" for _, _, s in BUILTIN_PRESETS)
