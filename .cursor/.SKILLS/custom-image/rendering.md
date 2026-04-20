# custom-image — rendering & performance

Cómo se pinta cada frame y por qué hay un sistema de "preview interactivo".

## Motor

**JavaScript puro corriendo en el main thread.** No WebGL, no Workers, no WASM. La pipeline (`src/pipeline.ts`):

```
ImageData (input)
  → loop por píxel (RGBA × W × H)
    → exposure → brightness → contrast
    → highlights / blacks (luma-weighted)
    → saturation
    → curves (master + per-channel via LUT)
    → denoise (3×3 box blur, opcional)
    → noise add (opcional)
  → ImageData (output)
```

Single-threaded. ~9 ops por píxel (más blur si denoise > 0).

## Costo real

Para una preview de 1920×1080 = ~2M píxeles × 9 ops = **18M ops por frame**. JS arithmético da ~50M ops/seg en hardware moderno → **~360ms por render** en el peor caso. A eso súmale la creación de buffers y el `putImageData`. Mover un slider dispararía ese costo en cada frame: la UI se traba.

Tests están instrumentados, pero el bottleneck no es algoritmico — es volumen de píxeles × single thread.

## Solución actual: preview interactivo a baja resolución

Mientras el usuario arrastra un slider o un punto de curva, renderizamos contra un buffer downscaleado (`MAX_INTERACTIVE = 480` en su lado más largo). Cuando suelta (después de `INTERACTION_RELEASE_MS = 150ms` sin más cambios), un render final corre contra el preview completo.

```
preview               1920×1080 (capped a MAX_PREVIEW)
interactivePreview    480×270   (capped a MAX_INTERACTIVE)
source                4096×... (capped a MAX_SOURCE) — solo se usa al exportar
```

### Por qué funciona

- **480p tiene ~16x menos píxeles que 1080p.** Render baja de ~360ms → ~22ms (~45fps efectivo).
- El upscale al display via `drawImage(tmp, 0, 0, fullW, fullH)` es **GPU-acelerado** en navegadores modernos. Costo despreciable comparado con el pipeline JS.
- El display size **no cambia** entre interactivo y full porque siempre forzamos `view.width = preview.width / view.height = preview.height` (intrinsic). Solo cambia la nitidez momentáneamente.
- Al soltar, el render full corre una sola vez (~360ms one-shot, aceptable).

### Implementación

`src/main.ts`:

```ts
let isInteracting = false;
let interactionEndTimer = 0;

function flagInteraction() {
  isInteracting = true;
  schedule();
  clearTimeout(interactionEndTimer);
  interactionEndTimer = window.setTimeout(() => {
    isInteracting = false;
    schedule();          // final full-res render
  }, INTERACTION_RELEASE_MS);
}
```

Triggers:
- Sliders: `input` event llama `flagInteraction()`.
- Curvas: `mountCurves(canvas, onChange)` — el `onChange` también llama `flagInteraction()`.

`schedule()` decide qué buffer usar:

```ts
const useInteractive = isInteracting && interactivePreview !== null;
const src = useInteractive ? interactivePreview! : preview;
const out = apply(src, state);
```

Y al pintar:

```ts
view.width = preview.width;     // intrinsic siempre = full preview
view.height = preview.height;
if (out.width === preview.width) {
  viewCtx.putImageData(out, 0, 0);
} else {
  // Upscale interactivo → full vía drawImage (GPU)
  const tmp = makeCanvas(out.width, out.height);
  tmp.ctx.putImageData(out, 0, 0);
  viewCtx.drawImage(tmp.ctx.canvas, 0, 0, preview.width, preview.height);
}
```

### Cuándo se rebuildea `interactivePreview`

`rebuildInteractivePreview()` se llama cuando cambia `preview`:
- Al cargar imagen nueva (`loadImage`).
- Al aplicar un crop (`#crop-apply`).
- Al restaurar el original (`#crop-reset`).

Es un downscale via `drawImage` con `imageSmoothingQuality: 'high'`. Costo ~50ms para una preview de 1920px → 480px. Solo corre una vez por cambio.

## Constantes (tune-points)

En `src/main.ts`:

```ts
const MAX_PREVIEW = 1920;             // longest edge del buffer "full"
const MAX_INTERACTIVE = 480;          // longest edge del buffer interactivo
const INTERACTION_RELEASE_MS = 150;   // espera sin cambios antes del render full
```

- Subir `MAX_INTERACTIVE` mejora la nitidez durante drag pero baja FPS.
- Bajar `MAX_PREVIEW` mejora el render full final pero pierde detalle al pintar.
- Subir `INTERACTION_RELEASE_MS` evita renders full innecesarios si el usuario hace tweaks rápidos en cadena (cuesta nitidez si paran corto).

## Out of scope (mejoras futuras si la perf vuelve a ser cuello de botella)

1. **Web Worker + OffscreenCanvas** — descarga `apply()` del main thread. La UI no se traba ni siquiera en el render full. Complejidad media (transfer de ImageData entre threads).
2. **WebGL shader fragment** — el pipeline es vergonzosamente paralelizable (cada píxel independiente). Ganancia 10-100x. Reescritura del pipeline a GLSL. Curvas LUT como `sampler2D` 1D.
3. **WASM con SIMD** — JS pixel loop reemplazado por Rust/AssemblyScript compilado a WASM con `i32x4` SIMD. Ganancia 4-8x. Mantiene main thread.
4. **Web Workers solo para denoise** — el blur es el más caro de las ops (3×3 = 9 lecturas por píxel). Mover solo eso a worker.

Para hoy, el preview interactivo cubre el 95% de los casos sin tocar la arquitectura.
