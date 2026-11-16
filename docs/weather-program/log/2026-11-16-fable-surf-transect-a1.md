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
