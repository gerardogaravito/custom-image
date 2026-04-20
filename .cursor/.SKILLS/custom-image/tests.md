# custom-image — tests

Unit tests over the pure surface of the editor: pipeline, curves LUT, HEIC detection. No DOM mounting, no UI wiring.

## Stack

- **Vitest 4.x** — native to Vite, shares the build config, no extra transpiler. Latest version since the project requires Node ≥20.19.
- **`@vitest/coverage-v8`** — V8 coverage provider (no Babel/Istanbul instrumentation, faster).
- **Environment**: `node`. We don't load `jsdom`/`happy-dom` because the engine doesn't touch the DOM.
- **`ImageData` polyfill** in `src/test/setup.ts` (~10 lines). The pipeline only needs `data`, `width`, `height` and the `(data, w, h)` constructor — that's all the polyfill provides.
- **`File` global** — available natively in Node ≥20, used by `heic.test.ts` to construct test fixtures.

## File map

```
.nvmrc                    # pins Node version for the project (24)
vitest.config.ts          # vitest config (env, includes, setup, coverage)
src/test/setup.ts         # ImageData polyfill for Node
src/curves.test.ts        # tests for buildLUT + isIdentity
src/pipeline.test.ts      # tests for apply()
src/heic.test.ts          # tests for isHeic()
src/crop.test.ts          # tests for resizeBox / moveBox / fitToAspect / cropImageData
```

Tests live next to the source they cover (Vitest convention). Excluded from the production tsc build via `tsconfig.json`'s `exclude`.

## Running

```bash
npm test          # watch mode
npm run test:run  # single run, exits 0/1 (CI)
npm run test:cov  # single run + V8 coverage report (text + html)
```

HTML coverage report opens at `coverage/index.html`.

## What's covered

**Last run: 112 tests / 4 files passing** over the measured surface (`pipeline.ts`, `curves.ts`, `heic.ts`, `crop.ts`). Pure functions kept at ~100% lines.

### `curves.ts` — `isIdentity` and `buildLUT`

- `isIdentity` truth table via `it.each` (canonical, moved endpoints, extra control points, degenerate inputs).
- `buildLUT` shape: always 256 entries, always `Uint8ClampedArray` (clamps out-of-range `y`).
- Degenerate inputs: zero points → identity, single point → constant LUT, duplicate `x` → no crash (the `|| 1` `dx` fallback).
- Identity preservation: `lut[i] === i`, robust to unsorted input.
- Endpoint clamping outside the control range.
- **Fritsch-Carlson monotonicity** verified across multiple cases via `it.each`, plus a regression case for the "flat then steep" overshoot scenario.
- Semantic shape of an S-curve (crushes shadows, lifts highlights, exact midpoint).
- Inverted curve `[{0,255},{255,0}]` is strictly decreasing.

### `pipeline.ts` — `apply()`

Organized into describes by feature for fast triage on failures.

- **Invariants**: dimensions, identity for default state, **input is not mutated**, alpha preserved under any combination, `[0,255]` clamping.
- **Exposure / brightness**: positive direction lifts, negative direction drops (`it.each` sweeps).
- **Contrast**: pushes shadows down and highlights up around 128, midpoint exact.
- **Saturation**: `-100` → strict grayscale (R=G=B per pixel); positive widens variance across channels.
- **Highlights / blacks**: luma-weighted — positive `highlights` lifts only bright pixels and leaves shadows ≈ untouched (and symmetric for `blacks`).
- **Curves**: flat master overrides earlier adjustments; per-channel only affects its channel; pipeline order — master runs before per-channel.
- **Noise**: `denoise` reduces variance on a high-frequency input; `noise > 0` perturbs ≥90% of pixels; `noiseSat = 0` → monochrome (R=G=B perturbation), `noiseSat = 100` → colored.

### `heic.ts` — `isHeic()`

- Detection by MIME (`image/heic`, `image/heif`, `image/heic-sequence`, `image/heif-sequence`), case-insensitive.
- Detection by extension when MIME is missing (`.heic`, `.heif`, case-insensitive).
- Negatives: png/jpg/webp/gif/pdf/no-extension, plus tricky cases like `heic.png` and `contains-heic-in-name.jpg`.

### `crop.ts` — pure crop math

- `parseAspect`: valid/invalid string parsing.
- `anchorOf`: every handle returns the right opposite point (corner / midpoint of opposite edge).
- `moveBox`: clamps to bounds (left/top/right/bottom), preserves dimensions.
- `resizeBox` (free mode): every handle moves the right side(s); enforces MIN_SIZE; clamps to bounds.
- `resizeBox` (aspect lock): the **regression case** — corners with cursor far outside bounds keep aspect intact (no clamping breaks the ratio). Edges keep the perpendicular center fixed.
- `fitToAspect`: produces a box with the requested ratio centered on the original; respects bounds for very narrow ratios.
- `cropImageData`: positional fingerprint test (each pixel encodes its `(x,y)` so we verify exact slicing); rounds non-integer coords; clamps oversized boxes; preserves alpha.

## Out of scope (covered via `/* v8 ignore */` or excluded in config)

- `mountCurves()` in `curves.ts` — DOM/canvas widget, exercised in the browser.
- `convertHeicToPng()` in `heic.ts` — needs `heic2any` WASM and a real Blob pipeline; would require heavy mocking.
- The crop **overlay/drag wiring** in `main.ts` (pointer events, sync overlay with canvas, ResizeObserver) — DOM-only. The pure math (`crop.ts`) is fully tested instead.
- `main.ts` and `toast.ts` — entrypoint and DOM wiring. Excluded entirely from coverage in `vitest.config.ts`. If a regression appears here, prefer manual repro or an e2e test with Playwright (separate from this unit suite).

## Coverage thresholds

Set in `vitest.config.ts` to enforce the surface stays well-tested:

```ts
thresholds: {
  statements: 95,
  branches: 85,
  functions: 95,
  lines: 95,
}
```

`npm run test:cov` fails the build if any threshold drops below these values.

## Adding a new test

1. Create `src/<module>.test.ts` next to the module.
2. Import explicitly from vitest: `import { describe, it, expect } from 'vitest'` (no globals — keeps the test file self-documenting).
3. For pipeline-style tests, reuse the `makeImage(w, h, fill)` / `solid(w, h, pixel)` helper pattern from `pipeline.test.ts` to build `ImageData` deterministically.
4. Use `it.each` for parametrized tables — keeps the file flat and the failure output crisp.
5. If a function is browser-only (touches DOM, canvas, WASM), wrap it in `/* v8 ignore start */ ... /* v8 ignore stop */` so coverage stays honest.
6. Run `npm test` — Vitest auto-discovers via the `src/**/*.test.ts` glob in `vitest.config.ts`.

## Gotchas

- `new ImageData(data, w, h)` works in tests via the polyfill, but the polyfill is **only** wired up by the Vitest setup file. If you import `pipeline.ts` from a non-Vitest Node script, you'll get `ReferenceError: ImageData is not defined`.
- The noise test asserts a statistical property (>90% of pixels differ). With seedless `Math.random()`, flakes are theoretically possible but vanishingly improbable at 16×16 with `noise = 50`. If it ever flakes, switch to a seeded RNG injected into `pipeline.ts`.
- The denoise test uses an LCG with a fixed seed (inline) so it's deterministic.
- `engines.node` in `package.json` is set to `>=20.19.0`. `.nvmrc` pins to `v24`. Vitest 4 needs Node ≥20.
