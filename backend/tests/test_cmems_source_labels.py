"""Guard: Copernicus Marine (CMEMS) wave data must never be labelled as ECMWF's own wave model.

WHY (owner, 2026-10-20): "the labeling was just wrong ... ive asked in the past, but its been missed".
CMEMS `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` (product GLOBAL_ANALYSISFORECAST_WAV_001_027) is
Météo-France's MFWAM, driven by ECMWF IFS winds. ECMWF's own wave model (ECWAM) is a different source,
fetched direct from ECMWF Open Data (`ecmwf_wave_service`, stream "wave"). The code called CMEMS
"ECMWF WAM" in the capabilities notes, the estimate-basis `source_model`, docstrings and the route
census, so anyone reading the code (or /api/weather/capabilities) was told the swells were ECMWF's.
This test pins the corrected labels so the old wording cannot come back silently.
"""
import os
import re

from services.weather_pipeline import capabilities

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Phrases that state, wrongly, that CMEMS data IS ECMWF's own wave model. Each was in the code until
# 2026-10-20. Phrases that name BOTH sources ("ECMWF-WAM or CMEMS MFWAM") stay allowed.
FORBIDDEN = (
    re.compile(r"ecmwf_wam_cmems"),                                   # estimate_basis source_model
    re.compile(r"REAL ECMWF-WAM", re.IGNORECASE),                     # "REAL ECMWF-WAM swells"
    re.compile(r"Fetches ECMWF WAM wave analysis"),                   # copernicus_marine_service docstring
    re.compile(r"Source model: ECMWF WAM"),                           # same docstring
    re.compile(r"ECMWF WAM 0\.25 degree global wave model\. Serves"),  # capabilities notes
)
SCANNED_DIRS = ("services", "routes", "scripts")


def _cmems_rows():
    return [r for r in capabilities.get_weather_capabilities()
            if str(r.get("upstream_model", "")).startswith("cmems_")]


def test_every_cmems_capability_names_mfwam():
    rows = _cmems_rows()
    assert len(rows) >= 4, "expected the four EURO marine rows to carry the CMEMS upstream_model"
    for row in rows:
        note = row["source_docs_note"]
        assert "MFWAM" in note, (row["layer"], note)
        assert "NOT ECMWF's own wave model" in note, (row["layer"], note)


def test_euro_waves_note_names_both_wave_models():
    waves = [r for r in _cmems_rows() if r["layer"] == "waves"]
    assert len(waves) == 1
    assert "ECWAM" in waves[0]["source_docs_note"]


def test_no_backend_source_labels_cmems_as_ecmwf_wam():
    hits = []
    for sub in SCANNED_DIRS:
        for dirpath, _dirs, files in os.walk(os.path.join(BACKEND, sub)):
            for name in files:
                if not name.endswith(".py"):
                    continue
                path = os.path.join(dirpath, name)
                with open(path, encoding="utf-8", errors="replace") as fh:
                    for lineno, line in enumerate(fh, 1):
                        for pat in FORBIDDEN:
                            if pat.search(line):
                                hits.append(f"{os.path.relpath(path, BACKEND)}:{lineno}: {line.strip()[:120]}")
    assert not hits, "CMEMS (MFWAM) labelled as ECMWF's own wave model:\n" + "\n".join(hits)
