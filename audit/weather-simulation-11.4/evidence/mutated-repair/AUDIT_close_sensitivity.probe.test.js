/**
 * AUDIT 11.4 — audit-only probe. Runs in a DISPOSABLE worktree; never shipped.
 *
 * QUESTION: mutation M2 (cache stores the PRE-close mask, so a hit skips the close) SURVIVED the
 * suite — including the test named "the cached mask is POST-close — a hit must not skip the close
 * and leak a raw mask". Why?
 *
 * HYPOTHESIS: the NARROW/WIDE fixtures are close-INVARIANT. If close(mask) === mask for those
 * inputs, then pre-close and post-close are the same bytes and no assertion over them can tell a
 * correct cache from M2. The assertion is real; the fixture cannot exercise it.
 *
 * This probe tests the hypothesis directly and then shows a fixture that WOULD discriminate.
 */
import { classifySheltered, _closeShelteredMask } from '../../../../frontend/src/components/map/marineMaskShelter';

const W = 20, H = 14;

const NARROW = [
  '~~~~~###############', '~~~~~###############', '~~~~~###############', '~~~~~###############',
  '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~~~~~~~~~~~~~###',
  '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~###############',
  '~~~~~###############', '~~~~~###############'
];
const WIDE = [
  '~~~~~###############', '~~~~~###############', '~~~~~###############', '~~~~~###############',
  '~~~~~#####~~~~~~~###', '~~~~~~~~~~~~~~~~~###', '~~~~~~~~~~~~~~~~~###', '~~~~~~~~~~~~~~~~~###',
  '~~~~~~~~~~~~~~~~~###', '~~~~~~~~~~~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~###############',
  '~~~~~###############', '~~~~~###############'
];

// A BROKEN RUN — the case the close exists for. The basin's connection to open water is a
// dotted 1-px canal (alternating water/land), exactly the Canal Grande sampling artefact.
const BROKEN_CANAL = [
  '~~~~~###############', '~~~~~###############', '~~~~~###############', '~~~~~###############',
  '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#~#~#~~~~~~~###',
  '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~#####~~~~~~~###', '~~~~~###############',
  '~~~~~###############', '~~~~~###############'
];

function waterFrom(rows) {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = rows[y][x] === '~' ? 1 : 0;
  return a;
}

function closeIsIdentity(rows, nPx) {
  const { sheltered, count } = classifySheltered(waterFrom(rows), W, H, nPx);
  const before = Uint8Array.from(sheltered);
  if (count) _closeShelteredMask(sheltered, W, H);
  let diff = 0;
  for (let i = 0; i < before.length; i++) if (before[i] !== sheltered[i]) diff++;
  return { count, diffPixels: diff, identity: diff === 0 };
}

describe('AUDIT 11.4 — is the morphological close observable on the suite fixtures?', () => {
  it('reports close-sensitivity for each fixture at the suite nPx', () => {
    const narrow = closeIsIdentity(NARROW, 1);
    const wide = closeIsIdentity(WIDE, 1);
    const broken = closeIsIdentity(BROKEN_CANAL, 1);
    // eslint-disable-next-line no-console
    console.log('AUDIT_CLOSE_SENSITIVITY ' + JSON.stringify({ narrow, wide, broken }));

    // The hypothesis under test: the shipped fixtures cannot see the close.
    expect(narrow.identity).toBe(true);
    expect(wide.identity).toBe(true);
  });

  it('a BROKEN-RUN fixture DOES move under close — so a discriminating fixture exists', () => {
    const broken = closeIsIdentity(BROKEN_CANAL, 1);
    expect(broken.diffPixels).toBeGreaterThan(0);
  });
});
