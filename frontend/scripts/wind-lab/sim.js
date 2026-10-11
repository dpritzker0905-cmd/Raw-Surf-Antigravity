// ═══════════════════════════════════════════════════════════════════════
// ONE SIMULATION — geography, wind, particles, trail. Theme-blind on purpose:
// nothing in this file knows which ground it will be drawn on.
// ═══════════════════════════════════════════════════════════════════════

const W = 1200, H = 840, STRIP = W / 3;
const GX = 240, GY = 168, CELL = W / GX;          // wind grid, 5 px cells
const MX = 600, MY = 420;                        // land mask, 2 px cells
const KN_MAX = 75;

let geo = null;        // { u, v, kn, land } on the wind grid
let landMask = null;   // Uint8Array MX*MY



// fbm on p5's seeded noise
function fbm(x, y, oct) {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { a += amp * noise(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return a;
}

// A Gulf-like coast: land to the north, a ragged shore with sounds and headlands, barrier islands offshore.
function landAt(x, y) {
  const shore = H * 0.40 + 230 * (fbm(x * 0.0013, 7.3, 3) - 0.5) + 36 * (fbm(x * 0.008, 3.1, 2) - 0.5);
  const sounds = 150 * (fbm(x * 0.0045, y * 0.0045 + 40, 3) - 0.5);           // inlets and headlands, cut in two dimensions
  if (y < shore + sounds) return 1;
  const ribbon = Math.abs(y - (shore + 46 + 14 * (fbm(x * 0.005, 1.7, 2) - 0.5)));
  if (ribbon < 3.2 && fbm(x * 0.011, 9.9, 2) > 0.48) return 1;
  return 0;
}

// Streamfunction psi: a steady synoptic flow + a seeded cyclone + fbm eddies.
// u = dpsi/dy, v = -dpsi/dx, so the field has no sources or sinks: particles neither pile up nor thin out on their own.
function buildGeo(p) {
  landMask = new Uint8Array(MX * MY);
  for (let j = 0; j < MY; j++) for (let i = 0; i < MX; i++) landMask[j * MX + i] = landAt((i + 0.5) * W / MX, (j + 0.5) * H / MY);

  const cx = W * (0.15 + 0.7 * random()), cy = H * (0.62 + 0.25 * random()), sig = 150 + 60 * random();
  const swirl = random() < 0.5 ? 1 : -1;
  const psi = new Float32Array((GX + 1) * (GY + 1));
  const dir = random(TWO_PI);
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) {
    const x = i * CELL, y = j * CELL;
    const r2 = ((x - cx) ** 2 + (y - cy) ** 2) / (2 * sig * sig);
    const base = (Math.cos(dir) * y - Math.sin(dir) * x) * 4.0;                   // a steady synoptic flow
    const cyclone = swirl * p.storm * 9000 * Math.exp(-r2);                          // a seeded low
    const eddies = 5200 * (fbm(x * 0.0011, y * 0.0011, 3) - 0.5);                      // synoptic-scale meanders, not turbulence
    psi[j * (GX + 1) + i] = base + cyclone + eddies;
  }
  const u = new Float32Array(GX * GY), v = new Float32Array(GX * GY), kn = new Float32Array(GX * GY);
  const land = new Uint8Array(GX * GY);
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const a = psi[j * (GX + 1) + i], b = psi[j * (GX + 1) + i + 1], c = psi[(j + 1) * (GX + 1) + i], d = psi[(j + 1) * (GX + 1) + i + 1];
    let uu = ((c + d) - (a + b)) / (2 * CELL), vv = -((b + d) - (a + c)) / (2 * CELL);
    const k = j * GX + i;
    const mx = Math.min(MX - 1, Math.floor((i + 0.5) * MX / GX)), my = Math.min(MY - 1, Math.floor((j + 0.5) * MY / GY));
    land[k] = landMask[my * MX + mx];
    const friction = land[k] ? 0.55 : 1.0;                                            // land drags the wind
    uu *= friction; vv *= friction;
    u[k] = uu; v[k] = vv;
  }
  // scale so the open-water median sits at the chosen everyday wind (kn)
  const spd = [];
  for (let k = 0; k < GX * GY; k++) if (!land[k]) spd.push(Math.hypot(u[k], v[k]));
  spd.sort((a, b) => a - b);
  const toKn = p.everyday / Math.max(1e-6, spd[spd.length >> 1]);
  for (let k = 0; k < GX * GY; k++) kn[k] = Math.min(KN_MAX, Math.hypot(u[k], v[k]) * toKn);
  geo = { u, v, kn, land, toKn };
}

function sampleWind(x, y) {
  const gx = Math.max(0, Math.min(GX - 1.001, x / CELL - 0.5)), gy = Math.max(0, Math.min(GY - 1.001, y / CELL - 0.5));
  const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * GX + i;
  const lerp2 = (A) => (A[k] * (1 - fx) + A[k + 1] * fx) * (1 - fy) + (A[k + GX] * (1 - fx) + A[k + GX + 1] * fx) * fy;
  return [lerp2(geo.u), lerp2(geo.v), lerp2(geo.kn)];
}
