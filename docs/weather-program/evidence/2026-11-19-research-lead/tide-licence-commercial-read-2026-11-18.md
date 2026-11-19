# Commercial-use licence read: FES2022, EOT20, CMEMS (research lead, 2026-11-18). NOT legal advice.
Question (director, for David): may a COMMERCIAL subscription service serve predictions derived from these products to
paying users? Read today, from the current texts.

## 1. FES2022 (AVISO). Source: AVISO License Agreement, Issue 20, August 2026, effective 10 Aug 2026
(https://www.aviso.altimetry.fr/fileadmin/documents/data/License_Aviso.pdf; it supersedes Issue 19 of Feb 2024).

Verbatim:
- Preamble: CNES wants the products "available for the widest possible use, including commercial use".
- §1(m): "Commercial Use: Any activity involving the sale, licensing, or commercial exploitation of Value-Added
  Products or Derivative Works based on AVISO Data Products."
- §2.1: "the Licensor grants You a worldwide, royalty-free, non-sublicensable, non-exclusive, irrevocable license
  ... to: A. reproduce and Share the Licensed Material ...; and B. produce, reproduce, and Share Adapted Material
  (Value-Added Products or Derivative Works), for any purpose, including commercial purposes, subject to Section 3
  ..., and — for certain products only — subject to the non-commercial-use note in Section 3.3 and Annex A."
- §3.1 Attribution: "retain ... identification of the creator(s) ... and CNES as Licensor; provide a citation to
  the source (product name, producer, DOI where applicable); include a link to this License ...; indicate if You
  modified the Licensed Material".
- §3.2: "You must not Share the Licensed Material, in its original, unmodified form, through any operational platform
  intended for onward mass distribution — including but not limited to a web portal, public API, or cloud data
  infrastructure — without prior written authorization from CNES." This "does not restrict Sharing Adapted Material".
- Annex A: "Currents from the latest released version of the FES ocean tide model (currently FES2022) —
  Non-commercial use only under this License; Commercial Use requires a separate agreement with CNES and NOVELTIS."
  "(All other AVISO Data Products ... are licensed under the full terms of Section 2.1(A)–(B), including for
  Commercial Use, subject to Sections 3.1 and 3.2.)"

**Verdict:** FES2022 tide ELEVATIONS (and the load tide) MAY be used commercially, royalty-free.
- Conditions:
  - (a) Attribution per §3.1. #1069 has the citation, DOI and modification note; it must ALSO carry a link to the
    licence. Check this.
  - (b) Never expose the original FES2022 files or constituent grids through a public API, portal or bucket (§3.2).
    Serving tide PREDICTIONS (adapted material) is fine.
  - (c) Do NOT use FES2022 tidal CURRENTS (non-commercial; Annex A). We don't.
- The PyFES code is GPL, so run it offline in Actions only (its output is not covered).

## 2. EOT20 (DGFI-TUM). Source: SEANOE dataset page (https://doi.org/10.17882/79489), dated 2021-06-28
- Licence: CC BY 4.0 (the page's licence link points to creativecommons.org/licenses/by/4.0/). No commercial
  restriction is stated.
- Required citation: "Hart-Davis Michael, Piccioni Gaia, Dettmering Denise, Schwatke Christian, Passaro Marcello,
  Seitz Florian (2021). EOT20 - A global Empirical Ocean Tide model from multi-mission satellite altimetry. SEANOE.
  https://doi.org/10.17882/79489". Also cite the ESSD paper, doi 10.5194/essd-13-3869-2021.

**Verdict:** commercial use is allowed under CC BY 4.0, with attribution: credit, a licence link, and an indication of
changes. Use the final open-access version.

## 3. CMEMS (Copernicus Marine). Source: the licence annex on marine.copernicus.eu "service commitments and licence"
Verbatim:
- §2.1: "This Licence is granted free of charge."
- §2.2(b): "... Derivative Work from Copernicus Marine Service Products for any purpose;"
- §2.2(c): "redistribute, disseminate any Copernicus Marine Service Product in their original form via any media."
- §2.4(a), for value-added and derivative works: "Generated using E.U. Copernicus Marine Service Information; insert
  DOIs links here". The credits must be "clearly visible on the home page of the Licensee's website or at least on the
  page allowing to access to the products".
- §2.6: Licensees must "maintain such records to document and trace use of Copernicus Marine Service Products".
- §8.1: "may revise this Licence at any time." SLA §3: free of charge until the service ends, "planned 30 June 2028".
- SLA §2.7: login and password are "personal to the signatory of the SLA and non-transferable".

**Verdict:** commercial use of derived products is permitted ("for any purpose", free of charge). The licence does not
name "commercial" explicitly, but "any purpose" covers it.
- Conditions:
  - (a) The exact credit wording plus DOIs, visible where the data is shown. #1069 uses it.
  - (b) Keep a use record (§2.6). The census wrapper and the ingest logs can serve as this.
  - (c) The account is personal to its signatory, so it must be David's (or the company's) account, used by name in
    Actions secrets.
- **PLANNING RISK:** the current service commitment runs to 30 June 2028. Watch for its renewal. FES2022 + EOT20
  (the tide) and ECMWF zos + msl (the residual) are the non-CMEMS fallbacks.

## Plain summary for David
All three may be used for a paid subscription app, free of charge, with credits. The only "don'ts":
- FES2022 tidal CURRENTS (we don't use them);
- re-publishing the raw FES2022 files themselves;
- skipping the credits and licence links.

## Compliance check (tide lane, 2026-11-18 late): all met
- **#1069 FES2022 credit_detail** includes the licence link (License_Aviso.pdf), citation, DOI, acknowledgement and
  modification note. `test_point_tide` asserts the link is present.
- **Nothing derived from FES leaves CI except predictions.**
  - Per-spot FES subsets and the PyFES evaluation stay on the Actions runner only.
  - The bucket holds hourly predictions (`tide_own/series.json.gz`) and altimetry mean levels (`tide_own/m.json`, not
    FES).
  - No constituent or atlas file is in the repo, a public bucket or an artifact.
- **FES currents** are not used.
- **CMEMS credit** is as required.
- **EOT20 credit** ships with T3.
