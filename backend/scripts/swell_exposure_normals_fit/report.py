import json, numpy as np
R=json.load(open('fit_all.json')); S=json.load(open('summary.json'))
ok=[x for x in R if x['usable']]
def pooled(rows,k):
    w=np.array([x['n_test'] for x in rows],float); return float(np.sum(w*np.array([x[k] for x in rows]))/w.sum())
nc=[x for x in ok if x['name']!='Cayucos Pier']
rng=np.random.default_rng(7); w=np.array([x['n_test'] for x in nc],float); d=np.array([x['test_chain']-x['test_fit'] for x in nc])
boot=[float(np.sum(w[i]*d[i])/w[i].sum()) for i in (rng.integers(0,len(nc),len(nc)) for _ in range(5000))]
exc_ci=np.percentile(boot,[2.5,97.5])
notbetter=[x for x in ok if not x['fit_better']]; flat=[x for x in ok if x['curve_width_deg']>=10]
L=[]; A=L.append
A('# Effective exposure normal: fit extended to all 77 California spots\n')
A('Method: `normals/fit_effective_normal.py`, functions copied unchanged (`ext/fit_all.py`). Per spot, n* on a 1-deg grid minimises the '
  'count-weighted MSE between the chain factor f(theta) and CDIP MOP\'s normalised attenuation A(theta) (median Hs_MOP/Hs_buoy per 10-deg bin, n>=30), '
  'fitted 2022-01..2023-12, scored on 2024-01..2025-03 (399-456 days of matched data, by buoy) against the chain normal and MOP metaShoreNormal on the same held-out hours.\n')
A('## Pooled held-out result (usable spots, weighted by held-out hours)\n')
A(f"- Usable: {S['n_usable']} of {S['n_spots']} (>=3 bins with n>=30 at n* in BOTH periods; every spot passes, min 6 bins).")
A(f"- Held-out MSE: chain **{S['pooled_test_chain']:.4f}**, MOP normal **{S['pooled_test_mop']:.4f}**, fit **{S['pooled_test_fit']:.4f}**.")
A(f"- Fit beats chain at **{S['fit_better']}/{S['n_usable']}**; beats MOP normal at {S['fit_better_than_mop']}/{S['n_usable']}.")
A(f"- Pooled improvement chain - fit: **{S['pooled_improvement']:.4f}**, spot-resampling bootstrap 95% CI **[{S['ci95'][0]:.4f}, {S['ci95'][1]:.4f}]** (5000 draws, seed 7).")
A(f"- Without the largest single contributor (Cayucos Pier, chain 0.290): chain {pooled(nc,'test_chain'):.4f} vs fit {pooled(nc,'test_fit'):.4f}, improvement CI [{exc_ci[0]:.4f}, {exc_ci[1]:.4f}].")
A(f"- Reproduces the 19-spot study exactly (same n*, same held-out MSEs).\n")
A('## Flags\n')
A('**Fit NOT better than chain out of sample** (keep the chain normal): ' + ', '.join(f"{x['name']} (chain {x['test_chain']:.4f} vs fit {x['test_fit']:.4f})" for x in notbetter) + '.\n')
A('**Flat / ambiguous optimum** (>=10 deg of normals within 10% of the train minimum): ' + ', '.join(f"{x['name']} ({x['curve_width_deg']} deg)" for x in flat) + '. n* there is weakly identified (read it as a +/- range, not a point); the fit still beats the chain out of sample at all of them except Centerville, and only marginally at Pacifica - Linda Mar.\n')
A('Other notes: Steamer Lane and Cowell\'s Beach share MOP SC149 (identical fit). Several spots share an MOP neighbour region and the fits cluster '
  'near 240-246 deg for W-facing coasts (see caveats). MOP metaShoreNormal is badly off at Doran Beach (MSE 0.74), Shelter Cove, Arena Cove, Goat Rock, Cayucos — '
  'the metadata normal disagrees with the response modelled by MOP itself there, so it is not a safe drop-in substitute.\n')
A('## Per-spot table (sorted by |fit - chain|)\n')
A('| spot | buoy | MOP (km) | chain | src | MOP n | fit n* | abs(fit-chain) | width | bins tr/te | n_train | n_test | days | MSE chain | MSE MOP | MSE fit | better |')
A('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for x in sorted(R,key=lambda x:-x['d_fit_chain']):
    A(f"| {x['name']}d {x['buoy']} | {x['mop']} ({x['mop_km']:.2f}) | {x['chain_normal']:.1f} | {x['chain_src']} | {x['mop_normal']:.1f} | {x['fit_normal']} | {x['d_fit_chain']:.0f} | {x['curve_width_deg']} | {x['bins_train']}/{x['bins_test']} | {x['n_train']} | {x['n_test']} | {x['test_days']} | {x['test_chain']:.4f} | {x['test_mop']:.4f} | {x['test_fit']:.4f} | {'yes' if x['fit_better'] else '**no**'} |")
A('\n## Data sources\n')
A('- CDIP MOP alongshore hindcast via THREDDS OPeNDAP `cdip/model/MOP_alongshore/<id>_hindcast.nc` (waveHs/Dp/Tp, index 192864::2 = 2022-01-01 onward, 2-hourly). 59 new point subsets fetched (6 processes, retries), 18 reused from `jac1_mop/dl/npz`.')
A('- Offshore buoys, CDIP archive `cdip/archive/<id>/<id>_historic.nc`, waveFlagPrimary==1, Hs>=0.5 m, 2022-01-01..2025-03-31:')
A('  - **168p1 Humboldt Bay North Spit (offshore, 117 m)**: Camel Rock, Moonstone, Centerville (north of Cape Mendocino, lat>=40.44).')
A('  - **094p1 Cape Mendocino (346 m)**: Shelter Cove, Fort Bragg, Caspar, Big River, Arena Cove (38.5-40.44 N).')
A('  - 029p1 Point Reyes: Goat Rock/Salmon Creek/Doran (just south of 38.5 N), Marin, SF, San Mateo.')
A('  - 157p1 Point Sur: Santa Cruz (incl. Waddell/Davenport), Monterey Bay, Carmel, Big Sur.')
A('  - 071p1 Harvest: Central Coast (Cayucos, Morro Bay, Pismo, Jalama; no closer deep offshore buoy — 076p1 Diablo Canyon is a 27 m nearshore buoy, not used) and Santa Barbara/Ventura west of Point Mugu.')
A('  - 067p1 San Nicolas Island: LA/OC/SD, **including County Line** (Ventura County, but east of Point Mugu with Zuma-like exposure; judgment call).')
A('- 139p1 Umpqua (Oregon) exists with Dp but was not needed; 128p1 Humboldt South Spit has no data in the window.\n')
A('## Caveats\n')
A('- The target is MOP\'s modelled attenuation, not observed surf; the fit calibrates the chain\'s directional factor to MOP, it does not validate MOP.')
A('- The test is temporal hold-out only (same buoy, same MOP point); it is not a spatial or independent-instrument test.')
A('- Only bins with >=30 samples count, so the fit sees the directions the buoy actually records (W-NW swell, S summer swell). Fits for open W-facing beaches '
  'cluster at 240-246 deg; part of that is genuine (refraction turns the effective normal toward the dominant swell) and part is the symmetric cos-lobe f being bent to the available bins. '
  'Effective normals are a calibration of f, not geographic shore normals.')
A('- Pooled MSE is dominated by a few large-error spots (Cayucos, Sands, Rincon, Capitola/New Brighton); the CI comes from spot resampling and is wide accordingly.')
A('- Spots sharing a buoy have near-identical n_test, so the weighting is nearly equal per spot; spots sharing an MOP point (Steamer/Cowell\'s) are not independent.')
A('- The 9/77 non-improvers are all spots where n* is within 1-16 deg of the chain normal and the chain MSE is already small (<0.014); the fit only loses badly at Manresa and Sunset State Beach (held-out MSE roughly doubles), where the 2022-23 optimum did not transfer.')
open('FIT_ALL.md','w',encoding='utf-8').write('\n'.join(L)+'\n')
print(len(notbetter),[x['name'] for x in notbetter]); print([x['name'] for x in flat]); print(exc_ci, pooled(nc,'test_chain'),pooled(nc,'test_fit'))
