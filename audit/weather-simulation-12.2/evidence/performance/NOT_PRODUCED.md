# Not produced — and the reason changed during this audit

Frame-rate figures from this audit's own probe measure the **runner**, not the product: headless
Chromium fell back to SwiftShader software GL. They are deliberately not stored as performance
evidence.

**The premise that no harness exists is false.** `useWebGLGuardrail.js:126` writes
`window.__MAP_RENDER_FPS__` every second, and `marine-nightly` runs a compositing harness that
analysed **387 animation frames**. This rescopes WS-CAN-0037 from *build a harness* to *read the one
that exists* — VERIFY item V3, which requires running on hardware GL and recording the renderer
string beside the figure.

Route latency IS captured, in `../network/health-791fdf78-window.json`.
