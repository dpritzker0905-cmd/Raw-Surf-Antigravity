"""tide_credits.py - the ONE place the served tide's attribution text lives (the advisor's PR B condition (b),
2026-11-20): the exact FES2022 acknowledgement AVISO asks for, plus the Copernicus Marine credit for the mean level M and
for the CMEMS sea level. The served series (tide_own), the /point-tide readout and the spot hub's /tides read it from
here, and the CI table builder stores an identical copy in every table (scripts/tide_own/own_rules.CREDITS, pinned
equal by tests/test_tide_own.py).

Licence basis (AVISO License Agreement, Issue 20, Aug 2026): s.2.1(B) lets a licensee "produce, reproduce, and Share
Adapted Material (Value-Added Products or Derivative Works), for any purpose, including commercial purposes"; s.3.1 asks
for the creator, CNES as licensor, a citation and a licence link; s.3.2's restriction "does not restrict Sharing Adapted
Material". Tide predictions computed from the FES2022 constituents are Derivative Works.
"""
FES_ACK = ("The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made freely available "
           "by AVISO")
FES_CITATION = ("CNES, 2024. FES2022 (Finite Element Solution) Tidal model (Version 2024). CNES. "
                "https://doi.org/10.24400/527896/A01-2024.004")
FES_LICENCE = "https://www.aviso.altimetry.fr/fileadmin/documents/data/License_Aviso.pdf"
CMEMS_CREDIT = "Generated using E.U. Copernicus Marine Service Information"

# per served source: the credit carried with every series and stored in every table (licence s.3.1: the creators and
# CNES, the CITATION with its DOI, and a link to the licence)
CREDITS = {
    "am": (f"{FES_ACK}. {FES_CITATION}. Mean sea level: {CMEMS_CREDIT} (altimetry, SEALEVEL_GLO_PHY_L4). "
           f"Licence: {FES_LICENCE}"),
    "cmems": f"{CMEMS_CREDIT} (Global Ocean Physics Analysis and Forecast, https://doi.org/10.48670/moi-00016).",
}
# am_h (gates/tide-a-harcon-v1.md s2, served only under SURF_TIDE_A_HARCON): near a NOAA CO-OPS harmonic station the
# astronomical tide comes from NOAA's published harmonic constants (a US Government work, public domain, 17 U.S.C. 105),
# blended into FES2022b, so both credits are carried.
NOAA_HARCON_CREDIT = ("Astronomical tide near NOAA stations: NOAA National Ocean Service, Center for Operational "
                      "Oceanographic Products and Services (CO-OPS), harmonic constituents (public domain)")
CREDITS["am_h"] = f"{NOAA_HARCON_CREDIT}; blended with: {CREDITS['am']}"
