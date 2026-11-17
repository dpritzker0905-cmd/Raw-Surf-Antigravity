# 2026-11-16 Fable: the slope-dependent breaker arm. The owner's answer on the source, what was read, then the run

Session: Fable repair lead (`e372475c`). Branch `fable/surf-slope-arm`, stacked on `fable/surf-transect-a1` (#969).
Offline, model only. Changes no served number; the serving path does not import the module.

## 2026-11-16 13:51Z The hold is lifted: the owner's words, and exactly what they cover

The arm was registered and held on 2026-11-16 at 10:30Z (`log/2026-11-16-fable-surf-transect-a1.md`) because its only
open source is a US Army Corps of Engineers manual and the owner had said "Skip using USACE".

**The owner's answer.** Typed by the owner in the ADVISOR's session at 08:45 EST on 2026-11-16, in reply to the
question "is a published formula printed in a USACE manual an acceptable source after your 'Skip using USACE'?".
His words as the advisor relayed them, verbatim: "Sure if we have a formula printed in a USACE manual that is publicly
shown, its acceptable." I did not see them typed; the advisor relayed them to me and to the director.

**What that covers, read narrowly:** a FORMULA, printed in a USACE manual that is publicly available. It does NOT
reopen USACE DATA. The Field Research Facility's gauges stay excluded, as withdrawn on 2026-11-16 at 03:49Z; nothing
here reads, fits or gates on them.

## 2026-11-16 13:51Z What I read on the page, equation by equation, before any run

**Source.** US Army Corps of Engineers, Coastal Engineering Manual, EM 1110-2-1100 (Part II), 31 July 2003, Part II
Chapter 4, section "Breaker criteria"; the page credits its figure II-4-2 to Weggel (1972). Read at
`coastalengineeringmanual.tpub.com/Part-II-Chap4/Part-II-Chap40006.htm` on 2026-11-16.

**How the page carries its equations, and what that means for "read".** The page is a text layer over an image. I
fetched both. The IMAGE shows only the fraction bars and the brackets: one fraction for equation II-4-5, a bracketed
factor for II-4-6, a fraction with a bracketed denominator for II-4-7. The SYMBOLS are in the text layer, where the
operators are font-substituted: an apostrophe stands where an equals sign belongs, an ampersand where a minus sign
belongs, a percent sign where a plus sign belongs, and a hash where "less than or equal" belongs. So the operators
below are my reading of substituted glyphs, checked against the layout in the image and against limits the page
states in plain words. They are not read off a rendered equation.

- **(II-4-5).** Text layer: "gamma_b ' b & a" beside the fraction "H_b" over "g T 2". Read as
  gamma_b = b - a H_b / (g T^2). The research lead warned that a text extraction swaps a and b; in mine the order is
  b then a, and the page's own prose fixes it either way: "the breaker index is bounded by the theoretical value of
  0.78, as the beach slope approaches zero, and ... 1.56, as the beach slope approaches infinity", which only works
  as b minus a times the steepness term.
- **Validity, text layer:** "for tan beta # 0.1 and H'o / Lo # 0.06": slope up to 0.1 and deep-water steepness up to
  0.06. READ, with the hash read as "less than or equal".
- **(II-4-6).** Text layer: "a ' 43.8 1 & e &19 tan beta", with a bracket pair in the image. Read as
  a = 43.8 (1 - e^(-19 tan(beta))). At slope zero a = 0, consistent with the 0.78 limit.
- **(II-4-7).** Text layer: "1.56" over "1 % e & 19.5 tan beta". Read as b = 1.56 / (1 + e^(-19.5 tan(beta))). At
  slope zero b = 0.78 and at large slope b tends to 1.56, both of which the page states in words.
- **Also on the page, in words:** "The breaking wave height H_b is contained on both sides of Equation II-4-5, so
  the equation must be solved iteratively"; and "For nonuniform beach slopes, the average bottom slope from the break
  point to a point one wavelength offshore should be used."

**The one step that is mine, not the page's.** Used as the limit H_max = gamma_b d of the random-wave model, with
H_b = H_max, the equation is linear in H_max and has a closed form: H_max = b d / (1 + a d / (g T^2)). No iteration
is needed, and the test suite checks that this H_max satisfies II-4-5 exactly.

**The rule for the run is the one registered at 10:30Z, unchanged.** The index is an individual-wave, regular-wave
breaker index used as the gamma of a random-wave model by substitution, not derivation. Slope: the one fitted from
the ETOPO transect, capped at the formula's limit of 0.1 and flagged where capped. Stop condition, the research
lead's: at the owner's point (slope about 1 in 250, 4.8 s, breaker about 1.1 m) a about 3.2, b about 0.81, gamma
about 0.79; if mine is more than 0.03 away, stop and check the form before reporting anything. And about 1.08 at
slope 0.05, 10 s, 2 m. My prediction: gentle beds nearly unchanged, steep beds somewhat higher.

## 2026-11-16 14:01Z The slope arm, run model-only: it RAISES the breaker by 1 to 3%, and does not lower the owner's number

**The stop condition passed before anything else was looked at.** At the owner's point (slope 1 in 250, 4.8 s,
breaker 1.1 m): a = 3.21 (predicted about 3.2), b = 0.810 (about 0.81), gamma = 0.795 (about 0.79, tolerance 0.03).
At slope 0.05, 10 s, 2 m: gamma = 1.078 (predicted about 1.08). The research lead and I have the same form.

**On the 20 panel beds that resolve a surf zone and have a fitted slope** (head-on; surf over offshore, the model's
own highest-tenth; geometric mean over spots with the 95% interval over spots):

| sea state | constant gamma 0.73 | slope arm | slope arm over constant | today's chain |
|---|---|---|---|---|
| wind sea, 1.0 m at 5 s | 1.26 | 1.27 | 1.01 (1.000 to 1.014) | 1.36 |
| the report's state, 1.12 m at 7.28 s | 1.44 | 1.47 | 1.02 (1.012 to 1.024) | 1.54 |
| swell, 1.5 m at 12 s | 1.64 | 1.67 | 1.02 (1.015 to 1.030) | 1.76 |
| groundswell, 2.0 m at 16 s | 1.65 | 1.68 | 1.02 (1.007 to 1.032) | 1.80 |

At the owner's point, the report's state: 1.49 with the slope arm, 1.47 with the constant, 1.47 from today's chain.
The breaker index at the point where the maximum is taken is 0.80 there, and 0.78 to 0.84 across the 20 beds.

- **The slope arm does not close the north-east Florida gap. It moves the number 1.5% the wrong way.** That is what
  the research lead predicted: on a gentle bed the index is essentially the classic 0.78, slightly above the 0.73 the
  constant arm uses, so the wave is allowed a little more height before it breaks.
- **On the panel it barely separates spots,** because every slope fitted from the 463 m grid is gentle: 1 in 82
  (Pipeline) to 1 in 1,084. The largest effect is at Pipeline, plus 2.4%. A reef that is steep at the scale of the
  break is not steep at the scale of this grid.
- **On planar beds, where the slope is what it says it is, the effect is real and grows with slope.** At the
  report's state: plus 1.4% at 1 in 250, plus 3% at 1 in 50, plus 6% at 1 in 20, plus 5% at 1 in 10. For
  groundswell (2.0 m at 16 s): plus 2% at 1 in 250, plus 4% at 1 in 50, plus 8% at 1 in 20, plus 12% at 1 in 10,
  with the index at the maximum rising from 0.80 to 1.30.
- **Inside the formula's stated validity everywhere it was run:** no bed's slope was capped, and no sea state
  exceeded the steepness limit. The saturation clip set the energy in 0 of 6,212 steps at the report's state.

**The predictions against the result.**
- The research lead's: gamma about 0.79 at the owner's point, so the arm "should NOT close the NE-Florida gap".
  Right, on both counts.
- Mine: "gentle beds nearly unchanged, steep beds somewhat higher". Right on planar beds. I also expected "the
  panel's spread to widen ... mainly at the reef and point spots": it widened from 1.38 to 1.47 to 1.41 to 1.50,
  which is a shift, not a widening, and the reef spots moved about as much as the beaches. That part was wrong, for
  the reason above: the grid's slopes do not know which spots are reefs.

**What this adds to the closing note of the A1 log.** One more arm measured, not fitted: the slope-dependent
breaker index is worth plus 1.5% at the owner's point. The combined figure there is unchanged in substance: about
3.5 ft against his under 2 ft, a factor of about 1.8, which is now also not the slope.

**Limits.** Model only, no truth. The index is an individual-wave, regular-wave relation used as a random-wave
limit by substitution. The slope is a large-scale fit on a 463 m grid; the manual asks for the average slope from
the break point to one wavelength offshore, which this grid cannot resolve. The operators in the equations were
read from font-substituted glyphs in the page's text layer, as recorded above; the stop condition and the manual's
stated limits (0.78 flat, 1.56 very steep) are what confirm the form.

## 2026-11-16 14:13Z The advisor's extra row: most of the rise on gentle beds is the constant, not the slope

The advisor (PASS WITH LIMITS at `72941d764`, no open condition) asked for one more row, reported only: the constant
arm at gamma 0.78, so the effect of the slope is separated from the change of constant (0.73 to the formula's
flat-bed 0.78). Same 20 beds, same sea states, same run otherwise. I had named this weakness myself before the row
was computed and had not computed it.

| sea state | constant 0.73 | constant 0.78 | slope arm | slope arm over constant 0.78, per spot |
|---|---|---|---|---|
| wind sea, 1.0 m at 5 s | 1.26 | 1.27 | 1.27 | 1.000 to 1.006 |
| the report's state, 1.12 m at 7.28 s | 1.44 | 1.46 | 1.47 | 1.001 to 1.012 |
| swell, 1.5 m at 12 s | 1.64 | 1.66 | 1.67 | 1.003 to 1.017 |
| groundswell, 2.0 m at 16 s | 1.65 | 1.67 | 1.68 | 1.001 to 1.019 |

At the owner's point, the report's state: 1.469 at 0.73, 1.486 at 0.78, 1.492 with the slope arm. Of the plus 1.6%
reported above, plus 1.2% is the constant and plus 0.4% is the slope.

Planar beds, slope arm over constant 0.78: at the report's state plus 0.3% at 1 in 250, plus 2% at 1 in 50, plus 5%
at 1 in 20, plus 4% at 1 in 10; for groundswell plus 0.6%, plus 3%, plus 7%, plus 10%.

- **This corrects the headline of the section above.** "Raises the breaker by 1 to 3%" was against 0.73. Against the
  formula's own flat-bed constant the slope itself is worth under 2% at every panel spot and 0.4% at the owner's
  point. On the panel's beds the slope term is close to inert.
- **The planar figures above were also against 0.73** and are about 1 to 2 points smaller against 0.78; the growth
  with slope stands. No conclusion changes.

**The advisor's caution, recorded as a limit of the whole A1 line.** Three model arms now agree with today's chain at
the owner's point (the transect, the spread, the slope). None has been compared with a measured breaker. Agreement
between models is not evidence that the chain is right there. It narrows where the gap can be, toward which height
the product is naming. And per the advisor: the panel result is about large-scale slopes and says nothing about reefs.
