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
