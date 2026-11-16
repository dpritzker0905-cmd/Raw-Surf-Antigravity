# 2026-11-16 Fable: arm A1, the cross-shore breaking transect. Built, run model-only on the panel

Session: Fable repair lead (`e372475c`). Branch `fable/surf-transect-a1`, cut from `dev` `34e7c1ce3`.
Changes no served number. The arm is an offline script the serving path does not import. No truth was read: this says
what the arm computes, not whether it is right.

## 2026-11-16 09:55Z What was built, from which source

The gate (`log/2026-11-16-fable-surf-ablation-s0-prereg.md`, "Arm A replaced", 02:31Z, and the withdrawal of FRF at
03:49Z) keeps arm A1 as a model-only run until a breaking-truth source has data. The director confirmed the arm stays
after the owner's decision on USACE data, since the method is published and open (2026-11-15 23:09 EST, a peer message).

**Equations.** SWAN Scientific and Technical documentation, section "Depth-induced wave breaking",
`https://swanmodel.sourceforge.io/online_doc/swantech/node16.html`. The research lead transcribed them and marked what
was unreadable; I then fetched the page and read each one against it, as the rule requires:

- (2.65), final form: D_tot = - alpha_BJ Q_b sigma_mean H_max^2 / (8 pi), with alpha_BJ = 1 in SWAN. READ, matches.
- (2.66): (1 - Q_b) / ln(Q_b) = -8 E_tot / H_max^2. READ, matches. Solved here by bisection.
- H_max = gamma d, d the total water depth. READ, matches.
- gamma: 0.8 (Battjes and Janssen 1978), average 0.73 (Battjes and Stive 1985), average 0.79 (Kaminsky and Kraus 1993).
  READ, matches. The arm uses 0.73.
- (2.67) defines sigma_mean as the spectrum's mean radian frequency. READ.
- (2.68), the explicit approximation of Q_b, is truncated on the page. NOT USED: (2.66) is solved directly.
- **Not on that page, so not implemented:** a slope-and-depth form of gamma (the coefficients relayed to me are not
  there and I have not used them), and the Thornton and Guza constant B. Those two arms stay NOT RUNNABLE.
- E_tot is taken as the wave variance, H_rms^2 = 8 E_tot, which is what the -8 in (2.66) implies. The page's own
  definition (its equation 2.49) was not read. If SWAN defines it otherwise, the breaking fraction is wrong by that
  factor; this is the one unverified step.

**The march** is derived from the energy-flux balance d(E_tot c_g cos theta)/dx = D_tot with linear-theory speeds and
Snell's law; it is not copied from any code. Module: `backend/scripts/surf_transect.py`. Tests:
`backend/tests/test_surf_transect.py` (10).

**Choices the equations leave open, fixed before the run:** sigma_mean = 2 pi / T_peak (the chain is handed a peak
period only; a real mean frequency is higher and would dissipate MORE); the model's height holds at the model point's
depth and flux is conserved to the seaward end of the transect; surf = the largest H1/10 on the transect, with the
chain's own 1.27; steps of 10 m, shortened on steep beds.

**Bed.** NOAA ETOPO 2022 15 arc-second (CC0) from NOAA's ERDDAP, a 0.09 degree box per spot, sampled every 100 m along
the spot's shore normal from 600 m behind it to 3 km seaward, out to 20 m depth. The boxes are in this session's
scratch folder, not in the repository.

## Guardrails checked (model only)

- **Monotone in the offshore height:** tested on a gentle, a steep and a barred bed at three periods, 0.2 to 6.0 m.
- **No wind input**, no environment flags, no network: the module imports `math` and nothing else. A test pins that,
  and that nothing under `services/`, `routes/` or `server.py` names it.
- **Controls in model form:** with the dissipation switched off the height follows linear shoaling exactly; with it
  on, the breaker height is lower and the inner surf zone is depth-limited.
- **Coverage is printed per spot** (table below). Fewer than 5 wet samples gives no number.

## Result on the 30-spot panel (head-on, four fixed sea states; 29 of 30 runnable)

Not runnable: Waikiki Queens, 1 wet sample (the 15 arc-second grid has the reef as dry or deep within 3 km).

**A1 gives almost the same breaker height as today's chain.** Geometric mean over spots of surf over offshore:

| sea state | A1 | today's chain | A1 range over spots |
|---|---|---|---|
| wind sea, 1.0 m at 5 s | 1.26 | 1.34 | 1.22 to 1.29 |
| the report's state, 1.12 m at 7.28 s | 1.41 | 1.52 | 1.21 to 1.48 |
| swell, 1.5 m at 12 s | 1.61 | 1.74 | 1.37 to 1.70 |
| groundswell, 2.0 m at 16 s | 1.64 | 1.80 | 1.41 to 1.81 |

By class at the report's state: inlet_jetty A1 1.43 [1.40, 1.46] against 1.69 [1.53, 1.92] served; open_beach 1.42
[1.37, 1.45] against 1.47; pier 1.40 [1.31, 1.47] against 1.47; point_reef 1.41 (4 spots) against 1.47.

- **At the owner's point: A1 1.47 times offshore, the served chain 1.47.** The arm does not lower his number.
- **A1 is barely more spot-aware than today's chain.** Twenty-four of the 29 spots read between 1.38 and 1.48 at the
  report's state. The three lowest (Pensacola Beach Pier 1.21, Rodanthe Pier 1.23, Crescent Beach 1.26) are an
  artifact, not a finding: on their beds the arm's largest wave is at the SEAWARD END of the transect (16.8 to
  20.6 m of water), which means the 463 m grid never shoals into a surf zone there within 3 km.
- **It ignores the hand-set magnets,** so the three inlet spots read like their neighbours (1.45 to 1.48) where the
  served chain reads 1.98 to 2.06.
- **Why it comes out the same.** The largest H1/10 on the line IS the breaker height: the wave shoals, reaches the
  depth where it starts to break, and that is the maximum. Dissipation acts after that point, shoreward. A constant
  gamma puts that point at a depth set by the wave, not by the beach, so a gentle slope and a steep one give nearly
  the same maximum. On planar test beds from 1 in 200 to 1 in 10 the arm gave 1.41 to 1.49 at the report's state.
  This was visible on the planar beds before any real bed was fetched.

**What DOES differ, and may be the real question.** The arm also gives the height along the line. Inside the surf
zone, at 1 m of water, the significant height at the report's state is 0.46 to 1.13 times offshore across the panel
(the owner's point 0.75; Wrightsville 0.57; Sebastian Inlet 0.56; Rincon and Steamer Lane about 1.1). The owner
expected under 2 ft where the product showed 5.1 ft: about 0.5 times offshore, not 1.4. **That is the range of the
INNER surf zone, not of the breaker.** So the gap may be one of definition before it is one of physics: the product
reports the largest breaker on the outer edge; a surfer on a flat beach in wind sea is describing what reaches the
inside after a wide zone of spilling whitewater.
- This is an observation about the arm's output and one expectation. It is not evidence: no height inside any surf
  zone was compared with anything.
- A limit on that number: at 1 m depth the height cannot exceed the saturation limit (0.73 m of H_rms, about 1.0 m
  of Hs), so in bigger seas the inner height says nothing about the offshore sea at all.
- Which point on the line is "the surf" is the owner's to define. It is a product question (what does the number
  mean to a surfer), and it decides what any breaking truth has to measure.

## Limits

- Model only. No truth. An arm that agrees with today's chain is not thereby right, and neither is today's chain.
- ETOPO at 15 arc-seconds (about 463 m) cannot resolve a sandbar, a reef edge or a channel. Slopes fitted from it
  (1 in 52 to 1 in 1,084 across the panel) are large-scale, and the "100 m samples" are interpolated between nodes
  about 460 m apart. A finer bed could change which spots differ.
- Head-on seas and a peak period only. The real mean period is shorter than the peak in a wind sea, which would
  raise the dissipation; not tested.
- The energy definition (equation 2.49) is the one unverified step, stated above.
- Constant gamma. The slope-and-depth form is exactly the piece that could make the breaker height depend on the
  beach, and it is NOT RUNNABLE until its source is read.

## For the gate

A1 with a constant gamma, scored as "largest H1/10 on the line", is so close to the Komar path that breaking truth
would have little to choose between them. Before truth arrives, two things would make the arm worth scoring: the
slope-and-depth gamma from a source that can be read, and a decision on what height the product is naming.

## 2026-11-16 10:07Z The unverified step is verified, and the inputs alone do not reach the owner's number

**Equation 2.49, read.** The research lead found it and I then read it on the page I had saved: E_tot is the
integral of the spectrum E(sigma, theta) over frequency and direction, with no rho g. So E_tot is the variance and
H_rms^2 = 8 E_tot holds. The one unverified step above is closed.

**The slope-dependent gamma stays NOT RUNNABLE.** The research lead reports that SWAN's user manual gives only its
default coefficients and no formula on any SWAN page. Until the formula is transcribed from an open page, no arm.

**The research lead's point, tested model-only:** a constant gamma fixes where dissipation happens, not the breaker
height, so if the owner's "under 2 ft" is about the outer breaker, the over-read must come from the INPUTS. Checked
at the owner's point (offshore 1.12 m, head-on, the spot's own geometry for today's chain, a 1 in 250 planar bed for
A1, which is the slope ETOPO gives there):

| period fed in | today's chain | A1 | A1, Hs in 1 m of water |
|---|---|---|---|
| 7.28 s (the model's peak) | 1.64 m, 1.47 x | 1.61 m, 1.44 x | 0.53 m |
| 6.0 s | 1.52 m, 1.36 x | 1.47 m, 1.31 x | 0.52 m |
| 4.8 s (the buoy's mean) | 1.39 m, 1.24 x | 1.37 m, 1.22 x | 0.50 m |
| 4.5 s | 1.36 m, 1.21 x | 1.38 m, 1.24 x | 0.49 m |

And today's chain at 4.8 s with the H1/10 conversion off: 1.10 m, 0.98 x offshore. With Komar off instead: 1.24 m.
With all six factors off: 1.12 m.

- **The period accounts for about 15%** (1.47 down to 1.24), in both today's chain and A1.
- **The H1/10 conversion accounts for another 21%** (1.24 down to 0.98), if it should not be applied to a wind sea.
- **Together they bring the breaker to about the offshore height, 1.1 m (3.6 ft).** The owner expected under 2 ft
  (0.6 m). So the two input corrections the research lead names, taken together, close roughly half the gap and
  leave a factor of about 1.8.
- **The only number in any run that sits at his expectation is the height inside the surf zone:** A1's significant
  height in 1 m of water is 0.49 to 0.53 m (1.6 to 1.7 ft) at every period tried. It barely moves with the period
  because at that depth the height is set by the water depth, not by the sea.
- Directional spread, the research lead's third input, is not tested: neither arm carries a spread.

**What this does to the question for the owner.** The research lead's evidence is that the published surf-forecast
convention is the breaking height in the surf zone at H1/10, which is the outer breaker and what the product names
today. On that convention, fixing the inputs gets to about 3.6 ft at his point that hour, not under 2 ft. Either the
breaker really was about 3.6 ft and smaller waves were what was being ridden inside, or something else is missing
(spread, a dissipation the model point has not seen, an offshore height that was itself too high: the buoy 30 km away
read 1.4 m, higher than the model, so not that). This is one expectation at one hour, not a measurement, and nothing
here can choose between those. A timed look at the water with the scale stated is what would.

**Limits.** Model only. One point, one hour's sea, a planar bed for A1. The 21% from H1/10 assumes the conversion is
simply absent; the physically argued alternative (a narrowed distribution at a saturated break) is not modelled.

## 2026-11-16 10:21Z The advisor's review: the headline restated with the model's own highest-tenth, diagnostics, and a correction

The advisor's condition on this PR: "surf" was the largest 1.27 x Hs on the line, and 1.27 is the open-sea Rayleigh
factor. Battjes and Janssen's model is a Rayleigh distribution TRUNCATED at H_max = gamma d, so no wave and no mean of
the highest tenth can exceed gamma d; where the sea is breaking, 1.27 x Hs reports more wave than the model allows.
That is correct, and the metric was wrong in principle.

**Order of events, for the record.** The first run (09:55Z) reported only 1.27 x Hs. The truncated highest-tenth
(`h110_truncated`) was added AFTER that model-only result had been seen, on the advisor's review. No truth was
involved at either point, so nothing is contaminated; the order is stated so it is not mistaken for a pre-registered
metric.

**The headline, both ways** (surf over offshore, geometric mean over the 29 runnable spots, head-on):

| sea state | truncated highest-tenth | 1.27 x Hs (first run) | today's chain |
|---|---|---|---|
| wind sea, 1.0 m at 5 s | 1.26 | 1.26 | 1.34 |
| the report's state, 1.12 m at 7.28 s | 1.41 | 1.41 | 1.52 |
| swell, 1.5 m at 12 s | 1.60 | 1.61 | 1.74 |
| groundswell, 2.0 m at 16 s | 1.63 | 1.64 | 1.80 |

At the owner's point: 1.47 truncated, 1.47 by 1.27 x Hs, 1.47 from today's chain.

- **The two metrics agree to within 0.01 at every sea state, so both headlines stand: A1 gives almost the same
  breaker height as today's chain, and it does not lower the owner's number.**
- **Why the correction barely moves it.** The advisor's worked example put the maximum in 1.2 to 1.7 m of water,
  where the truncation binds hard. The march puts it in 2.5 to 3.2 m: the largest highest-tenth occurs where the wave
  has shoaled but only a fraction of a percent of waves are breaking (H_rms about 0.4 of H_max), and shoreward of
  that the dissipation takes more than shoaling adds. So the maximum is set by the onset of breaking, not by
  saturation. On planar beds from 1 in 250 to 1 in 10 the truncated number is 1.39 to 1.45; it differs from
  1.27 x Hs by at most 3% (on the steepest bed).
- That also answers the advisor's (e): with the truncated metric the maximum is still not tied to gamma d at the
  break point, because it is reached before saturation. The comparison with Komar does not change.

**The advisor's other points.**
- **(a) E_tot as the variance:** closed twice over. The advisor's derivation (Battjes and Janssen's dissipation
  divided by rho g is exactly equation 2.65) and the page's equation 2.49, which I read.
- **(b) Is the clip doing the physics? No.** The march now counts the steps where the saturation limit, not the
  dissipation term, set the energy. At the report's state: 0 of 8,862 steps over the 29 spots; wind sea 0; swell 6;
  groundswell 20. At a QUARTER of the step the result moves by at most 0.23% (0.10% to 0.23% across the four sea
  states). The term is doing the work. The earlier test "the inner surf zone is depth-limited" could have passed on
  the clip alone; a new test pins zero clipped steps on three planar beds and a quarter-step answer within 0.5%.
- **(c) Mean frequency.** With the mean period taken as 0.8 of the peak (in the dissipation only; the wave still
  shoals on the peak), the result is 0.996 to 1.000 of the base across all spots and sea states. The choice of
  sigma_mean is worth at most 0.4% on the breaker height. It matters inside the surf zone, not for the maximum.
- **(d) The bed is a plane fitted to coarse data,** and the first paragraph of this log should have said so: on a
  463 m grid the surf zone is one or two nodes. The shoreline rule takes the most SEAWARD dry sample, so a bar,
  islet or jetty tip becomes the shore. The bed now reports `water_landward_of_shore`; it is non-zero at Ponce Inlet
  North Jetty (2 samples) and Duck (3). Those two beds may have dropped an inner profile.
- **Which spots resolved a surf zone at all.** Twenty have a wet sample in 2 m of water or less; on those the
  truncated number at the report's state is 1.38 to 1.47. Six have nothing shallower than 2.1 to 4.6 m (St.
  Augustine Inlet North Jetty, Steamer Lane, Rincon, Blacks Beach, Galveston, Port Aransas Jetty), so their maximum
  is at or near the innermost sample and may be understated. Three never shoal within 3 km (Crescent Beach, Rodanthe
  Pier, Pensacola Beach Pier: shallowest wet sample 11.8 to 12.2 m); their 1.21 to 1.26 is the offshore wave, not a
  breaker. Waikiki Queens has no number.

**A CORRECTION to the first result section (mine; the advisor's (f) caught it).** I wrote that the significant height
"at 1 m of water" was 0.46 to 1.13 times offshore. That was wrong. I took the innermost sample at or below 1 m, which
on beds with no shallow sample is 2 to 12 m deep; every value above about 0.8 was at such a depth, and 1.1 times
offshore in 1 m of water is above the model's own limit there. Restated on the 13 spots that have a sample within
0.2 m of 1 m depth: **0.53 to 0.76 times offshore.** The owner's point has no sample that shallow; its nearest is at
1.24 m, where the height is 0.75 times offshore. The 10:07Z section's "0.49 to 0.53 m in 1 m of water" is from a
planar bed sampled every 20 m and is unaffected.
- The observation stands in weaker form: inside the surf zone the model's height is roughly half to three quarters
  of the offshore height, which is where the owner's expectation sits; and it is still an observation, not evidence.

**Still true.** Model only, no truth. Nothing here says whether the breaker height, from this arm or from today's
chain, is right.

## 2026-11-16 10:30Z Two more model-only arms REGISTERED, NOT RUN: a slope-dependent breaker index, and directional spread

The research lead sent open sources for both (2026-11-16 05:28 EST, peer messages). This section is the rule for
each, written before either is run. Nothing below has been computed by me.

**A question about the source that is the owner's to answer, and why neither arm is run yet.** Both sources are pages
of the Coastal Engineering Manual, a public-domain publication of the US Army Corps of Engineers. The owner's
decision of 2026-11-15 was "Skip using USACE and innovate free ways to figure it out". The director read that as
being about USACE DATA (the FRF gauges, whose terms forbid commercial use) and confirmed that a published open
method (SWAN) is fine. A formula printed in a USACE manual is a published method, and the breaker index is Weggel's
(1972), reproduced there; but the publisher is USACE, which is closer to the owner's words than SWAN was. I have not
opened either page. **Both arms stay NOT RUN until the owner, or the director relaying him, says a USACE manual is
an acceptable source for a published formula.** If not, the same formulas need a non-USACE open source, or the arms
are dropped.

### Arm `bj_transect_weggel`: the breaker index depends on the bed slope

- **What it is.** In the march above, H_max = gamma d with gamma = 0.73 everywhere. Here gamma is the breaker index
  as relayed from the manual's equations II-4-5 to II-4-7: gamma_b = b - a H_b / (g T^2), with
  a = 43.8 (1 - e^(-19 tan(beta))) and b = 1.56 / (1 + e^(-19.5 tan(beta))), tan(beta) the bed slope.
- **Before any run:** the equation is an image on the page and the text extraction swaps a and b; the order is fixed
  by the flat-bed limit (slope 0 gives a = 0 and b = 0.78). I must read the page image myself and record what I read.
- **Stated validity:** slope up to 0.1 and deep-water steepness up to 0.06; for an uneven bed the average slope from
  the break point to one wavelength offshore. H_b appears on both sides, so it is solved by iteration.
- **What it is NOT:** it is an individual-wave, regular-wave breaker index. Using it as the gamma in H_max = gamma d
  of a random-wave model is a substitution, consistent in spirit and not a derivation. Registered as that.
- **Slope used:** the slope fitted from the ETOPO transect over 1 m depth to the break depth, the same bed as above,
  with the same warning that a 463 m grid gives a large-scale plane.
- **Predictions written before the run, so they can fail.** The research lead's: at the owner's point (slope about
  1 in 250, 4.8 s, breaker about 1.1 m) a is about 3.2, b about 0.81, gamma about 0.79, so this arm should NOT close
  the north-east Florida gap; at a steep bed (slope 0.05, 10 s, 2 m) gamma is about 1.08, taller breakers. If my run
  gives a gamma at the owner's point more than 0.03 from 0.79, one of us has the form wrong: stop and check, do not
  report. Mine: because the largest wave on the line is reached before saturation (the 10:21Z section), a larger
  gamma moves the onset of breaking shoreward and should RAISE the breaker somewhat on steep beds and leave gentle
  beds nearly unchanged; I expect the panel's spread to widen from the present 1.38 to 1.47 mainly at the reef and
  point spots.

### Arm `spread`: a broad sea refracts differently from a single direction

- **What it is.** Today's chain and the march treat the sea as one direction. A real sea is spread over directions,
  a wind sea much more than a swell. Each direction refracts by Snell's law and conserves its energy flux, so on
  straight parallel contours a component arriving at angle theta0 to the shore normal has height ratio
  sqrt(cos(theta0) / cos(theta)). For a spread sea the components combine by ENERGY:
  K_eff^2 = integral of (cos(theta0) / cos(theta)) x G(theta0 - theta_mean) d(theta0), with components heading
  offshore contributing nothing.
- **This is a DERIVATION from linear superposition,** not an equation from a paper. The research lead found no
  opened source that prints an energy-weighted refraction factor for a spread sea. Registered as derived.
- **Spreading shape:** G proportional to cos^(2s) of half the angle from the mean direction (relayed from the
  manual's equation II-1-166), normalised numerically so its integral is 1.
- **Spread parameter s, as relayed, none of it fitted:** swell 25 where a steep wind sea is present, 75 where the
  wind sea is of small steepness; wind sea from the manual's II-1-168, which needs the wind speed and the peak
  frequency. **That last one is a problem for this lane's rule that wind is never a height input.** So the wind-sea
  s is NOT taken from the wind: it is run as a band, s in {5, 10, 25}, and reported as a sensitivity. The manual
  itself notes its wind-sea relation is not validated against field data.
- **Applied per partition** (wind sea, swell), with the chain's exposure factor OFF in this arm, since the exposure
  factor is the chain's own stand-in for the same effect and the two would double-count.
- **Prediction, written before the run:** the sign is NOT known in advance and I will not guess it into the rule.
  For a mean direction near the shore normal, spreading puts energy at larger angles, which refract more and arrive
  smaller: the factor falls. For an oblique mean direction, the components nearer the normal refract less, and the
  factor can RISE. So this arm is not guaranteed to lower anything. The research lead's reading is that the
  remaining factor of about 1.8 at the owner's point is either spread or the observation-convention question; I
  expect spread to be worth at most ten to fifteen percent for a broad wind sea near the normal, far short of 1.8.
  If it comes out near 1.8 I will suspect the arm before I believe it.

### For both

Model only. Scored on breaking truth later, by the gate's rules, when a truth source has data. Neither is fitted to
the owner's one expectation at one hour. Offline modules the serving path does not import. No wind input. Each gets
the guardrails of the second addendum to the gate: monotone in the offshore height, coverage printed, a range.

## 2026-11-16 10:35Z A named arm for the gate, from the advisor: wave by wave (NOT built)

The advisor re-read this PR at d9904cee3 and has no open condition. It derived the truncated highest-tenth
independently and it matches, and it checked the balance point by hand: on a 1 in 50 bed at the report's state the
dissipation removes about 0.07% of the flux per metre at 3 m of water against 0.33% gained by shoaling, and 1.9%
against 0.5% at 2 m, so the maximum falls between, as the march has it.

**Its answer to my question (is the onset too gentle) names what this arm cannot see.** Battjes and Janssen is a
bulk-energy model, calibrated on profiles of H_rms across the surf zone. It says where the SEA STATE starts to lose
energy. It was not calibrated on the height of the largest individual breakers. The 1.58 m highest-tenth wave it
reports in about 3 m of water has a height of 0.53 of the depth, which by any single-wave criterion (0.78 and up) has
not broken yet; that wave keeps shoaling until about 2 m. So the largest breaker a surfer sees is probably a little
higher and further in than this arm's maximum.

**Arm `wave_by_wave`, named here for the gate, NOT built and NOT run:** draw individual wave heights from the
offshore Rayleigh distribution, shoal each one, break each at its own height-to-depth limit, and read the highest
tenth of the BREAKER heights. It needs a single-wave breaker index from a source that can be read, which is the same
source question as the slope arm above, so it waits with it.
- **Prediction, written before it exists:** it will read HIGHER than both this arm and today's chain at the owner's
  point, not lower, because each large wave is carried further in before it breaks. If so, it moves the model's
  outer breaker further from the owner's expectation, and strengthens the reading that his number is about a
  different wave from the one the product names.

## 2026-11-16 10:42Z The spread arm's rule AMENDED before its run: a non-USACE source, and no wind

The 10:30Z section registered the spread arm with values from a USACE manual and held it. The research lead has since
found a non-USACE, open-access source that prints the same quantities, so the source question no longer applies to
THIS arm (it still applies to the slope arm, which stays held). This section replaces the spread arm's inputs. It is
written before the arm is built or run.

**Source, read by me on the page.** Y. Goda, "Overview on the applications of random wave concept in coastal
engineering", Proc. Japan Academy Ser. B 84(9), 374 to 385 (2008), open at PubMed Central (PMC3721201).
- Its equation [5]: the directional spreading function is G = G0 cos^(2s)((theta - theta0) / 2), G0 set so that G
  integrates to one over the full circle, theta0 the principal direction. READ.
- Its equation [6]: s = s_max (f / f_p)^5 below the peak frequency and s_max (f / f_p)^(-2.5) above it. READ.
- Its text: Goda and Suzuki "proposed the values of s_max = 10, 25 and 75 for wind waves, swell with short decay
  distance, and swell with long decay distance, respectively". READ.

**Inputs, fixed now.**
- Wind sea: s = 10. Swell: run at BOTH 25 and 75 and report both, because the decay distance is not among our
  inputs and I will not invent a proxy for it after seeing a result.
- **No wind.** The value for wind waves is a constant from the paper; nothing in the arm takes a wind speed or
  direction. The band {5, 10, 25} of the 10:30Z section is dropped as the arm's input and kept only as a printed
  sensitivity for the wind sea.
- **s is taken as s_max at every frequency.** Equation [6] makes the sea BROADER away from the peak, so a bulk arm
  with s = s_max UNDERSTATES the spreading of a real sea. Stated so the arm's effect is read as a lower bound on
  the size of the effect, whichever its sign.

**The arm, a derivation and not a paper's equation.** The sea's energy is divided among directions by G. Each
direction refracts by Snell's law and conserves its own energy flux; the directions are summed by energy. Breaking
removes energy from every direction in proportion to the energy it holds, which is how SWAN distributes its
dissipation over the spectrum (its equation 2.69, read on the page: the dissipation of a component is D_tot / E_tot
times that component's energy). Components heading away from the shore are dropped, and the share dropped is
printed. With a single direction the arm must reproduce the existing march exactly; a test pins that.

**What is reported.** The surf (both highest-tenth numbers) with spread, beside the same without, at the panel's
four sea states, head-on and at 30 and 60 degrees off the shore normal; the wind-sea state at s = 10, the swell
states at 25 and at 75.

**Predictions, unchanged from 10:30Z and restated so they can fail.** The sign is not known in advance. Near the
normal I expect spreading to LOWER the surf, by at most ten to fifteen percent for s = 10; at a large mean angle I
expect it to RAISE the surf relative to a single direction. Nowhere near the factor of 1.8 still unexplained at the
owner's point. If it comes out near 1.8, I will suspect the arm.

## 2026-11-16 10:49Z The spread arm, run model-only: worth one to eight percent, always downward; one prediction of mine was wrong

Run under the rule amended at 10:42Z (Goda 2008; s = 10 for a wind sea, 25 and 75 for swell; no wind). The march now
carries the sea as about 89 directions weighted by the spreading function; with a single direction it reproduces
the earlier march exactly (all 15 earlier tests pass unchanged, and a very narrow spread matches a single direction
to within 0.5%).

**On the 20 panel beds that resolve a surf zone** (a bed sample in 2 m of water or less). Surf with spread over
surf without, geometric mean over spots, with the range; the surf is the model's own highest-tenth:

| sea state | spread | head-on | 30 degrees off the normal | 60 degrees off |
|---|---|---|---|---|
| wind sea, 1.0 m at 5 s | s = 10 | 0.99 (0.97 to 1.00) | 0.99 (0.96 to 1.00) | 0.92 (0.90 to 0.93) |
| the report's state, 1.12 m at 7.28 s | s = 10 | 0.97 (0.97 to 0.97) | 0.96 (0.96 to 0.96) | 0.95 (0.91 to 0.97) |
| swell, 1.5 m at 12 s | s = 25 | 0.99 | 0.98 | 0.98 |
| swell, 1.5 m at 12 s | s = 75 | 1.00 | 0.99 | 0.99 |
| groundswell, 2.0 m at 16 s | s = 25 | 0.99 | 0.98 | 0.98 |
| groundswell, 2.0 m at 16 s | s = 75 | 1.00 | 0.99 | 0.99 |

At the owner's point, the report's state: 0.967 head-on (1.42 times offshore with spread against 1.47 without),
0.962 at 30 degrees, 0.948 at 60 degrees.

- **Directional spread lowers the surf by about 3% for a wind sea near the shore normal, by up to 8 to 10% at a
  steep angle, and by 2% or less for swell.** Sensitivity for the wind sea, head-on, on a 1 in 250 bed: 0.937 at
  s = 5, 0.968 at s = 10, 0.987 at s = 25.
- **At 60 degrees most of the effect is energy that never arrives.** A wind sea with its mean direction 60 degrees
  off the normal has 13% of its energy heading away from the shore (the shoreward share is 0.867); that energy is
  dropped, and it is most of the 8%.
- **It does not explain the gap.** The research lead read the remaining factor of about 1.8 at the owner's point as
  either spread or the observation-convention question. Spread is worth 0.97. With the period (about 0.85) and the
  H1/10 conversion (about 0.79) it brings the outer breaker to about 0.95 of the offshore height, 3.5 ft, against
  his under 2 ft. The convention question is what is left.

**My predictions against the result.**
- "Near the normal I expect spreading to LOWER the surf, by at most ten to fifteen percent for s = 10": it lowers
  it, by 3%. Right in sign, and the size was within the bound.
- "At a large mean angle I expect it to RAISE the surf relative to a single direction": **WRONG.** At 60 degrees it
  lowers it, by 5 to 8%. My argument (components nearer the normal refract less) is true of each component and
  missed two things that outweigh it: the components on the far side refract more or never arrive, and the height
  that reaches the break point is dominated by energy flux toward the shore, which a spread sea at a steep angle
  has less of. I registered the sign as unknown and then guessed it in the same paragraph; the guess was wrong.
- "Nowhere near the factor of 1.8": right.

**Limits.** Model only, no truth. The spread parameter is held at s_max for every frequency, and the paper's
equation 6 makes a real sea broader away from the peak, so the true effect is somewhat larger than these numbers
(the s = 5 row, 0.94, is a rough upper bound on its size for a wind sea near the normal). Straight parallel contours
are assumed, which a real coast with a bar, a point or an inlet is not. Head-on and two fixed angles, not a
climatology. A wind sea is given the same spread everywhere, with no dependence on how developed it is, because
that dependence is on the wind and wind is not an input here.

## 2026-11-16 10:54Z Where this stands: the arms are MEASURED, NOT FITTED, and two inputs are open

So that nobody tunes a factor to close the gap in the meantime (the research lead's suggestion).

**Measured, model only, at the owner's point (1.12 m offshore at the model's 7.28 s peak; served 1.47 times offshore):**

| arm | what it changes | effect on the outer breaker | status |
|---|---|---|---|
| period | the buoy's 4.8 s mean in place of the model's 7.28 s peak | x 0.85 | measured, not fitted |
| H1/10 conversion | no 1.27 on a wind sea | x 0.79 | measured, not fitted |
| directional spread | s = 10 (Goda 2008) | x 0.97 | measured, not fitted |
| breaking model | Battjes and Janssen transect, gamma 0.73, in place of Komar | x 1.00 (1.47 against 1.47) | measured, not fitted |
| highest-tenth metric | the model's own truncated distribution | x 1.00 | measured, not fitted |
| slope-dependent gamma | Weggel's index | not run | HELD: its only open source so far is a USACE manual |
| wave by wave | each wave to its own breaking point | not built | named; predicted to read HIGHER |

Taken together the three that move it give about 0.95 of the offshore height, 3.5 ft. They were measured one at a
time and need not multiply exactly. The owner expected under 2 ft. **A factor of about 1.8 remains, and it is not
spread, not gamma, and not the highest-tenth metric.**

**None of these is a fix, and none is to be applied to the served number.** Each is one model run at one point for
one hour's sea, compared with one expectation that is not a timed observation. Applying any of them, or any constant
that happens to close the gap, would be fitting to n = 1. The gate in
`log/2026-11-16-fable-surf-ablation-s0-prereg.md` is the only route to a served change.

**The two open inputs. More model arms cannot settle either.**
1. **Breaking truth:** timed, scale-stated observations of the surf (the in-app observations, the Sentinel-2
   surf-zone detection, the owner's labelled looks). None has data yet.
2. **The owner's definition:** whether the product should name the largest breaker on the outside, which is the
   published forecasting convention and what it names today, or what reaches the inside where people ride. It is
   his to say.

## 2026-11-16 10:57Z The advisor's review of the spread arm: three checks run, and the oblique case is less settled than I wrote

The advisor passed the spread arm at cec2e0913 with no open condition and made six points. The module is unchanged
by this section; the checks below were run in a scratch session against it (on a 1 in 250 planar bed, the slope ETOPO
gives at the owner's point).

- **Why my prediction had to fail, in the advisor's words.** On straight parallel contours a direction's energy at
  the break goes as the cosine of its offshore angle. Cosine is concave over the whole shoreward half, so the mean of
  the cosine over a spread is below the cosine of the mean (Jensen), head-on or oblique. Spreading can only lower it
  under this geometry.
- **(a) The s = 5 row is a SENSITIVITY, not a bound.** I called it "a rough upper bound on its size"; that was a
  hand-wave. Withdrawn.
- **(b) The offshore-heading share is being removed twice, and it matters at a steep angle.** The spreading function
  is normalised over the full circle, so at a 60 degree mean with s = 10, 13% of the energy is assigned to
  directions heading offshore and dropped. But a model's height at a point near a coast already holds little energy
  coming from the land. Run both ways, surf with spread over surf without:

  | sea state | angle | shoreward share | offshore share dropped (as reported above) | shares renormalised to the shoreward half |
  |---|---|---|---|---|
  | wind sea | 0 | 1.000 | 0.975 | 0.975 |
  | wind sea | 30 | 0.990 | 0.981 | 0.986 |
  | wind sea | 60 | 0.867 | 0.902 | 0.969 |
  | report | 0 | 1.000 | 0.968 | 0.968 |
  | report | 30 | 0.990 | 0.962 | 0.966 |
  | report | 60 | 0.867 | 0.970 | 1.030 |

  **Near the normal nothing changes: about 3% lower either way. At 60 degrees the answer depends on the convention:
  3 to 10% lower if the offshore share is counted as lost, between 3% lower and 3% HIGHER if it is not.** The truth
  for a coast lies between the two. So "always downward" in the 10:49Z heading is true of the arm as built and is NOT
  established for a steeply oblique sea. Renormalising moves the mean direction toward the normal, which is why it
  can rise; that is the effect I predicted, appearing only under one of the two conventions. The Jensen argument and
  this do not conflict: it holds for a fixed total energy spread symmetrically, and the renormalised sea is not
  symmetric about its nominal mean.
- **(d) Straight parallel contours do not describe the inlets and the points.** Of the 20 beds in the 10:49Z table,
  the inlet_jetty spots (New Smyrna Beach Inlet, Ponce Inlet North Jetty, Sebastian Inlet First Peak, Manasquan
  Inlet, South Padre Jetties) and the point_reef spots (Lower Trestles, Pipeline) are ones this geometry cannot
  describe. The table's means include them; the open_beach and pier spots alone give the same figures to two
  decimals, because the arm depends on the bed only weakly. Marked here, not re-run.
- **(e) Bin size.** At 1 degree in place of 2: the result changes by 0.001% at s = 10 and 0.000% at s = 75.
- **(f) The three together, run once, in place of a product.** Period 4.8 s, spread s = 10, head-on, and the largest
  significant height on the line with no highest-tenth factor: **1.08 m, 0.96 of the offshore height, 3.5 ft.** The
  product of the three measured separately was 0.94. So the 10:49Z sentence ("about 0.95, 3.5 ft") stands as a
  single run, and the closing note's table should be read with this as its combined figure.

**The advisor's caution, kept:** this arm says a spread sea reads 0 to 8% lower under these assumptions, model only.
It is not evidence about the chain's error at the owner's point.
