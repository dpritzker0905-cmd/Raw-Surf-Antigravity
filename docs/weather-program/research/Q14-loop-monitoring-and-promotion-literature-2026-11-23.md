# Q14: drift monitoring and champion/challenger promotion, literature for the self-improving loop

Dated 2026-11-23. Research only. Nothing built, served or dispatched. Sources were read at **abstract level** through Consensus unless marked. Items marked **UNVERIFIED** were not read in full or not found.

## A. Drift and degradation alarms with controlled false alarms

- **Autocorrelation shifts the run lengths.** Lu and Reynolds (2001) show that CUSUM charts on AR(1)-plus-noise processes perform differently from their independent-data design. Charting residuals from a model forecast, or the raw observations, behave similarly except at high autocorrelation with large shifts. Their method designs the chart for observations under autocorrelation. Source: [Lu et al. 2001, J. Quality Technology](https://consensus.app/papers/details/w:b98cf522-d51d-4360-99c6-b81036413fcb/?utm_source=claude_code) (abstract). **Limit:** AR(1) only; our forecast-error streams are not known to follow it.
- **Residual-based charts for autocorrelated streams.** Wang et al. (2023) combine CUSUM and EWMA on residuals from a regression model, with the control limit estimated by bootstrap of in-control data, and report better sensitivity to small shifts than multivariate CUSUM or EWMA alone. Source: [Wang et al. 2023, QREI](https://consensus.app/papers/details/w:c03ba77f-b97b-4a4d-89bb-098dd1209a6c/?utm_source=claude_code) (abstract). **Limit:** an industrial multivariate case; no forecast-verification application.
- **Analytic ARL for ARIMA streams.** Phanthuna et al. (2026) give an explicit ARL formula for a modified EWMA under ARIMA processes with exponentially distributed noise, validated against integral-equation solutions. Source: [Phanthuna et al. 2026, Measurement and Control](https://consensus.app/papers/details/w:9718fb8d-1451-4cd8-9742-4e393e90123f/?utm_source=claude_code) (abstract). **Limit:** an assumed noise distribution; new and not yet cited.
- **How the centres monitor drift.** ECMWF monitors forecast accuracy constantly, using a small set of headline scores (for example, the lead time at which 500 hPa anomaly correlation falls to 80%), with live verification charts, a yearly *Evaluation of ECMWF forecasts* report, and reports to its Technical Advisory Committee. Source: [ECMWF, Monitoring the accuracy of IFS forecasts (Confluence)](https://confluence.ecmwf.int/x/tLeLEg) (read directly); [ECMWF verification overview](https://www.ecmwf.int/node/20991) (search-reported). ECMWF is a WMO Lead Centre for ensemble and wave verification (search-reported; the WMO Lead-Centre terms are in the ECMWF overview). **Not found:** a published CUSUM or EWMA alarm on ECMWF's headline scores. The centre's public description is trend review, not a formal control chart. **UNVERIFIED** for NCEP and Met Office: the NCEP verification description and Met Office monitoring were not read in this session.
- **Recommended default for us:** a one-sided CUSUM on daily skill differences, computed on day blocks (not runs), with a control limit set by a block bootstrap of in-control history, plus the Lu et al. (2001) design check at our autocorrelation. **Limit:** the ARL under our real autocorrelation is unknown until we estimate it.

## B. Champion-versus-challenger with repeated looks

- **Always-valid p-values and confidence sequences.** Johari et al. (2021) define always-valid p-values and confidence intervals for A/B tests that stay valid under continuous monitoring, and report use on a large commercial platform. Source: [Johari et al. 2021, Operations Research](https://consensus.app/papers/details/w:e49841ca-21e7-4ec7-ba6a-0040e8a032ba/?utm_source=claude_code) (abstract). They also give multiple-testing control in the sequential setting.
- **E-processes and anytime-valid inference.** Ramdas et al. (2023) summarise safe anytime-valid inference: e-processes for testing and confidence sequences for estimation, valid at all stopping times. Source: [Ramdas et al. 2023, Statistical Science](https://consensus.app/papers/details/w:5fffa8ae-cf83-4c29-a545-91ae62fc3d3b/?utm_source=claude_code) (abstract). **Limit:** a survey of theory; no forecast-verification application read.
- **Design-based confidence sequences for dependent units.** Ham et al. (2026) extend anytime-valid methods to time series and switchback designs, and state that the standard approach is a special case of theirs for independent A/B tests. Source: [Ham et al. 2026, Management Science](https://consensus.app/papers/details/w:7f67b6e7-1375-4901-a3c8-41508fca65d7/?utm_source=claude_code) (abstract). **Limit:** a design-based framework; not checked for serial-dependence assumptions in forecast errors.
- **Sequential model confidence sets.** Arnold et al. (2026) extend the model confidence set of Hansen et al. (2011) sequentially with e-processes and confidence sequences, giving time-uniform coverage. Source: [Arnold et al. 2026, JRSS-B](https://consensus.app/papers/details/w:c7edadeb-98f7-47a5-bb8c-a0bd86fd4a55/?utm_source=claude_code) (abstract). **Most direct match to our champion/challenger question** among the sources found. **Limit:** new, not read in full.
- **Fixed-window Diebold–Mariano with HAC errors.** Harvey et al. (2024) show the standard Diebold–Mariano test has asymptotic size zero when the loss-differential mean drifts over time, and propose a local-demeaning long-run variance that is consistent under both constant and time-varying means. Source: [Harvey et al. 2024, JBES](https://consensus.app/papers/details/w:14ab6035-5c3e-429f-a2dd-64837331c42c/?utm_source=claude_code) (abstract). A second paper by the same authors gives heteroskedasticity-robust variants. Source: [Harvey et al. 2024, JAppEcon](https://consensus.app/papers/details/w:3f411c2b-74c1-46bb-816e-302cf14747ef/?utm_source=claude_code) (abstract).
- **Champion/challenger in production.** Nath (2007) describes keeping challengers scored alongside the champion without affecting live predictions, and re-selecting when outcomes arrive. Source: [Nath 2007, IEEE SoutheastCon](https://consensus.app/papers/details/w:acb21f4f-f19d-4ff4-88b2-a6c5ff760956/?utm_source=claude_code) (abstract). **Limit:** no statistical safeguard against repeated looks is stated.
- **Defensible default for a daily job:** an anytime-valid comparison (e-process or confidence sequence on the daily loss differential) for the stopping decision, and a block-bootstrap Diebold–Mariano with the Harvey et al. (2024) variance as the reported fixed-window test. Keep both, and only promote on the anytime-valid result. **Limit:** this is a recommendation from the sources above, not a tested procedure.

## C. FDR versus FWER across about 100 buoys, 3 models and 6 lead bins

- **FDR under dependence.** Benjamini and Yekutieli (2001) prove that the Benjamini–Hochberg procedure controls FDR under positive regression dependence, and that a conservative modification controls it under arbitrary dependence. Source: [Benjamini & Yekutieli 2001, Annals of Statistics](https://consensus.app/papers/details/w:0ba0e1c6-55e5-4a6e-9eaf-f342aca8a3c0/?utm_source=claude_code) (abstract). Our cells are correlated (shared runs and days, shared buoys), so BY, not BH, is the safe choice.
- **Closure and e-values for FDR.** Xu et al. (2025) show that BY is dominated by a closed procedure based on e-values, and give a general closure principle for FDR and other error rates. Source: [Xu et al. 2025, arXiv](https://consensus.app/papers/details/w:5c409b84-1a69-45e4-85b0-db1b589c5e3f/?utm_source=claude_code) (abstract). **Limit:** a preprint; the e-value version is more powerful but more complex to explain.
- **FWER for a small family.** Holm's step-down procedure controls FWER without assumptions, and is the usual choice when a false alarm is expensive. The sources read here did not directly compare Holm with BY on our layout; the claim that Holm is preferred for a few expensive alerts is **UNVERIFIED** from a primary source in this session.
- **Recommended default:** control FDR over the full cell family at 10% with BY on day-block resampled p-values, and require FWER (Holm) for any single cell that triggers a served action. **Limit:** the cell count (about 100 × 3 × 6 = 1,800) and the dependence structure must be estimated before the thresholds are fixed.

## D. Locked final test set and reusable holdouts

- **Reusable holdout.** Dwork et al. (2015, Science) show how to reuse a holdout set many times to validate adaptively chosen analyses without overfitting it, using ideas from differential privacy. Source: [Dwork et al. 2015, Science](https://consensus.app/papers/details/w:c2ef2e8f-b3f3-4934-aeba-a7f6490acdf6/?utm_source=claude_code) (abstract). A companion NeurIPS paper gives the description-length and max-information unification. Source: [Dwork et al. 2015, NeurIPS](https://consensus.app/papers/details/w:37ff584c-a03a-49d9-b293-bafbbabc2d11/?utm_source=claude_code) (abstract). A STOC paper gives the exponential-improvement result for estimating many adaptive expectations. Source: [Dwork et al. 2015, STOC](https://consensus.app/papers/details/w:752eb7ea-2ae6-4641-b864-dfc1ae67aee4/?utm_source=claude_code) (abstract).
- **Practical limit.** The reusable-holdout guarantees assume i.i.d. samples from a fixed distribution. Our buoy-days are serially dependent, and the forecast system itself changes. A locked holdout is therefore a sensible design, but the guarantee does not transfer as stated.
- **Recommended default:** a locked test set of whole run-days, touched only by a pre-registered gate, with the reusable-holdout mechanism for any repeated use. **Limit:** the dependence and nonstationarity caveat above, which is not addressed in the sources read.

## Summary of defaults

| Question | Default | Main limit |
|---|---|---|
| Drift alarm | one-sided CUSUM on day-block skill differences, bootstrap limits, ARL checked at our autocorrelation | ARL under real autocorrelation unknown |
| Champion vs challenger | anytime-valid e-process or confidence sequence for the decision; Harvey-corrected Diebold–Mariano reported beside it | sequential methods read at abstract level |
| Multiplicity | BY on day-block p-values at FDR 10%; Holm for any single served action | cell dependence to be estimated |
| Holdout | locked run-day set, reusable-holdout mechanism | i.i.d. assumption not met |

## Not verified

- NCEP and Met Office verification monitoring procedures (not read).
- A published CUSUM or EWMA alarm applied to ECMWF's headline scores (none found).
- Holm versus BY trade-off on a layout like ours (no primary source read).
- Full texts of the sequential and anytime-valid papers (abstracts only).

## Verification of this path (2026-11-23)

Checked with SubQ (subq-savant-1.4, high effort) and Reflection (Beam-1.0). LongCat's review was not completed: its submit call failed on a network error and its billing outcome may be uncertain, so LongCat's view is **missing** and nothing was retried.

| Item | SubQ | Reflection | Change to the defaults |
|---|---|---|---|
| (a) drift CUSUM | sound, conditional | weak | Block-bootstrap limits are valid only if they reproduce the in-control long-run variance and dependence, not just lag-1. Simulate ARL0 under a block or AR(1) null at several block lengths and seasons. Add a two-sided check, since one-sided CUSUM misses drift in the other direction. |
| (b) champion vs challenger | sound | weak | Anytime validity holds only for the null it was built for. A champion update, or restarting the e-process after a CUSUM alarm, changes the null. Pre-register the restart rule and the alpha spending. The corrected Diebold–Mariano is a diagnostic beside the decision, not the decision rule. |
| (c) multiplicity | weak | weak | BY and Holm need valid p-values on a fixed family. Ordinary day-block p-values are not valid after repeated looks, so use e-values or restrict BY and Holm to scheduled analyses. Holm over about 1,800 cells may reject nothing. Selecting a served action from the BY set needs a gatekeeping or selective-inference rule. |
| (d) reusable holdout | weak | **wrong** | The Dwork guarantees assume i.i.d. data and a bounded query budget. Continuous re-evaluation and drift violate both. Use the locked set only for bounded final queries, and rolling-origin validation otherwise. |

**Cross-check of the arithmetic (SubQ):** 1,800 streams at an in-control ARL of 500 give about 3.6 false drift alarms per day across the family. Per-stream calibration is not enough; the family needs a global false-alarm budget.

**Conflicts between defaults (both reviewers agree there are conflicts):**
1. Per-stream CUSUM ARL versus global multiplicity over 1,800 streams.
2. CUSUM alarms that restart or update the champion versus the anytime-valid guarantee.
3. Sequential decisions (for (b)) versus fixed-look p-value adjustments (for (c)). These are different error frameworks.
4. BY's discovery set versus Holm's family-wide control, when the served action is chosen from the discovery set.
5. The holdout used for tuning versus the holdout kept clean.

**Revised defaults (proposed, not yet tested):**
- (a) two-sided CUSUM on day-block skill differences, with limits set so the family-wide false-alarm rate meets a stated budget.
- (b) anytime-valid e-process on the daily loss differential for the decision, with restart and alpha-spending rules fixed in advance.
- (c) e-values or scheduled-only BY and Holm; a gatekeeping rule for any served action chosen from a discovery set.
- (d) locked run-day holdout for bounded final queries only; rolling-origin validation for everything else.

**Next checks, none run:** simulate ARL0 and family false-alarm rates under a block-dependent null; simulate the full selection pipeline (discovery, then served action) on null data; stress the holdout on drifting synthetic data.

## LongCat review (retry, 2026-11-23)

The first LongCat submit failed on a network error, and its billing outcome is uncertain. The retry returned a review. Verdicts: (a) weak, (b) sound in principle but weak as specified, (c) weak, (d) weak to wrong.

- **(a)** The CUSUM's false-alarm control is not shown to survive repeated looks, resets and a BY layer applied to its output. Check: simulate the full loop (resets, look frequency, BY layer) under a stationary null with realistic autocorrelation; measure false-alarm rate and detection delay.
- **(b)** "Anytime-valid e-process or confidence sequence" is not one method. Validity depends on its construction, the null and the dependence assumptions. A Harvey-style correction does not by itself give anytime validity. Check: write down the exact e-process, the null and the dependence model, and verify a test-martingale inequality under that model.
- **(c)** The family of hypotheses is not defined: 1,800 cells, or also the repeated days? BY on day-block p-values controls FDR for a block, not necessarily a sequence of decisions. "Holm for any single served action" is ambiguous when an action is a policy. Check: enumerate the family for BY and Holm; measure realized FDR and FWER by resampling.
- **(d)** Reusable-holdout guarantees assume i.i.d. samples and a specific query mechanism. Autocorrelated, nonstationary forecast errors violate that. A locked run-day holdout can go stale under drift. Check: name the exact reusable-holdout variant and theorem, and test its assumptions on autocorrelated data.

**Conflicts (LongCat agrees with SubQ and Reflection):** (a) and (c) mix a sequential statistic with batch FDR; (b) and (c) use different error frameworks for the same decisions; (d) is i.i.d.-based while (a) to (c) handle dependence. LongCat's overall view: the path is plausible but not yet coherent. It asks for one written specification before implementation: data-generating assumptions, exact hypotheses, decision timing, error target, and how holdout reuse interacts with sequential testing.

With all three reviewers in, the revised defaults stand as proposals, not decisions. The single specification LongCat asks for is the next step, and it is not done.
