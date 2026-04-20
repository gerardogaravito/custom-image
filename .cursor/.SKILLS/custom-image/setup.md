# custom-image — setup

Single-page image editor. Client-side only. Deploys to `custom-image.garavito.dev` (Vercel).

## Stack

- **Vite + TypeScript vanilla**. No React, no router, no framework. The app is a `<canvas>` with a floating panel — a framework would be dead weight.
- Build: `tsc && vite build` → static `dist/`. No server, no API routes.
- TS `strict`, `noUnusedLocals`, `noUnusedParameters`.

## Why standalone (not in `portafolio/garavitodev`)

`garavitodev` is Next 13 multi-tenant by host (middleware rewrites `garavito.dev` → `/garavito`, etc.). This editor needs none of that — pure client canvas work. Keeping it separate avoids coupling.

Deploy: independent Vercel project, custom domain `custom-image.garavito.dev` via CNAME → `cname.vercel-dns.com`.

## File map

```
index.html             # shell + full SEO/OG/JSON-LD head
public/favicon.png     # 64x64 PNG, browser tab icon
public/og.png          # 1200x630 social preview (Facebook, Twitter, etc.)
public/robots.txt      # allow all crawlers + AI bots (GPTBot, ClaudeBot, etc.)
public/llms.txt        # markdown summary for LLMs (emerging convention)
public/sitemap.xml     # single-URL sitemap
src/style.css          # all styles, no preprocessor
src/types.ts           # State, Adjust, Curves types + defaults
src/curves.ts          # monotonic-cubic LUT builder + curve widget (mountCurves)
src/pipeline.ts        # apply(src, state): ImageData → ImageData (pixel ops + blur + noise)
src/crop.ts            # pure crop math (resize/move/fit + cropImageData)
src/heic.ts            # HEIC detection + lazy heic2any conversion
src/toast.ts           # toast utility (with optional inline action button)
src/undo.ts            # UndoStack<T> + History<T> (past + future)
src/main.ts            # upload, preview/export rAF loop, UI wiring, undo/redo, zoom, analytics
```

Feature-specific docs live alongside this one: `zoom.md`, `recortar.md`, `rendering.md`, `herramientas.md`, `undo.md`, `seo.md`, `tests.md`.

## Key design decisions

- **Two image buffers**: `source` (full-res, capped 4096px) and `preview` (capped 1920px). Sliders render the preview in `requestAnimationFrame`; export runs the pipeline on `source` and then scales with `drawImage` at chosen factor.
- **Pipeline order** matters: exposure → brightness → contrast → highlights → blacks → saturation → curves (master then R/G/B) → denoise → noise add. Curves last so LUTs sit on corrected pixels.
- **Curves LUT**: Fritsch-Carlson monotonic cubic (no overshoots, Photoshop-like). `isIdentity()` skips the LUT loop when a channel is untouched.
- **Denoise**: 3×3 box blur mixed with original by strength. Not edge-preserving. If quality complaints arise, swap for bilateral (more expensive).
- **Noise**: regenerated per render with `Math.random()` — causes mild flicker while dragging sliders, accepted as a tradeoff for simplicity. `noiseSat` (0–100) mixes monochrome vs per-channel color noise.
- **Export**: `OffscreenCanvas.convertToBlob()` for PNG/JPG. Quality slider only relevant for JPG (hidden for PNG).
- **No persistence**: state is in-memory. Reload = reset. Not yet wired to localStorage or URL.

## Aesthetic

Inspired by `garavito.dev` and `thirdworlds.net` — pure black bg (`#0a0a0a`), mono (`ui-monospace`), one accent (`#d4ff00` lime). Active tabs invert (bg = accent, fg = bg). Channel buttons show channel color when active (R red, G green, B blue). No rounded corners, no shadows, no transitions beyond hover color swaps.

## Dev / build / deploy

```bash
npm install
npm run dev        # vite dev server
npm run build      # tsc + vite build → dist/
npm run preview    # serve dist/ locally
```

Vercel: auto-detects Vite. No `vercel.json` needed.

## Gotchas

- `new ImageData(Uint8ClampedArray, w, h)` is picky about `ArrayBuffer` vs `ArrayBufferLike` under strict TS. When copying, use `new Uint8ClampedArray(buf.buffer.slice(0))` to get a fresh `ArrayBuffer`.
- `OffscreenCanvas.convertToBlob` is Chromium/Firefox fine, but if Safari issues appear, fall back to `HTMLCanvasElement.toBlob()`.
- Box blur is O(w·h·9). On 4096² at export, it's a short freeze — acceptable because export is user-initiated. If it becomes a problem, separable blur or WebGL.
- Highlights/blacks weight by luma `(0.2126·R + 0.7152·G + 0.0722·B) / 255`. Curve intensities (`hi·80`, `bl·80`) are empirical — adjust if they feel too strong/weak.

## Open extensions (not built)

- Persist state in URL or localStorage
- Bilateral denoise
- Stable (cached) noise pattern
- Presets / snapshots
- Keyboard shortcuts for tab switching
