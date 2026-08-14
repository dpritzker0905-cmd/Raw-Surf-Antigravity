# Captured, but stored with its run rather than here

The WebGL capability census for each browser is in `../browser-device-tests/coverage-*.json` under
`capabilities`. The material result:

| config | renderer | maxTexture | webgl2 | webgpu |
|---|---|---|---|---|
| chromium desktop | ANGLE (Google, Vulkan 1.3.0 (**SwiftShader**)) | 8192 | yes | present |
| chromium mobile | same SwiftShader | 8192 | yes | present |
| **firefox desktop** | **ANGLE (NVIDIA, GeForce GTX 980)** | **16384** | yes | present |

**The two engines took different GPU paths on identical hardware.** Nothing in the program records
that, and it is why every frame-rate number from the chromium probes measures the runner.
