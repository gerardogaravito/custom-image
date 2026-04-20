# custom-image — recortar (crop)

Pestaña de recorte tipo iPhone Photos. Overlay en vivo sobre el canvas con 8 handles, lock de proporción y orientación, aplicar destructivo y restaurar al original.

## Arquitectura

Dos capas separadas por SRP:

1. **`src/crop.ts`** — lógica pura. Sin DOM, sin canvas. Funciones:
   - `resizeBox(handle, cursor, original, bounds, aspect)` — calcula la nueva box al arrastrar un handle.
   - `moveBox(box, dx, dy, bounds)` — paneo (handle = `move`).
   - `fitToAspect(box, aspect, bounds)` — re-encaja la box a una nueva proporción manteniendo el centro.
   - `cropImageData(src, box)` — slice de píxeles, devuelve un `ImageData` nuevo (no muta el source).
   - `parseAspect("4:5") → 0.8` — helper.
   - `anchorOf(handle, box)` — punto fijo durante el drag (corner opuesto, mitad del lado opuesto, etc.).
   - `fullBox(bounds)` — box inicial = imagen completa.

2. **`src/main.ts`** — wiring DOM. Mantiene el estado (`cropBox`, `cropAspect`, `cropOrient`, `cropActive`), engancha pointer events sobre los handles, sincroniza el overlay con el canvas y dispara `applyCrop` / `resetCrop`.

## Coordenadas

Toda la lógica trabaja en **píxeles del preview** (ej. 1920×1080). El overlay se renderiza escalando esas coords al tamaño actual del canvas en pantalla:

```
scale = view.clientWidth / preview.width
displayBox = cropBox * scale
```

Al aplicar el recorte, las coords se proyectan al `source` (full-res, hasta 4096px) multiplicando por `source.width / preview.width` y `source.height / preview.height`. Así un crop hecho sobre el preview queda nítido en el export final.

## Originales para restaurar

`loadImage()` guarda referencias a los buffers iniciales:

```ts
originalSource = source;
originalPreview = preview;
```

Estos nunca se modifican. `cropImageData` siempre crea un buffer nuevo, así que `apply()` y similares no contaminan los originales. **No hacer deep copies** — son innecesarias y consumen memoria de imágenes grandes.

`resetCrop` simplemente reasigna `source = originalSource` y `preview = originalPreview`. Como `apply()` (pipeline) **no muta** su input (verificado por test), compartir referencias es seguro.

## Lock de proporción + bounds

El bug clásico al implementar crop: dragueás un handle con aspect lock y al chocar contra el borde de la imagen, el clamping rompe la proporción (la box se vuelve rectángular cuando debería seguir siendo cuadrada).

**Fix**: en lugar de calcular box → clampear, calculamos el espacio disponible desde el anchor, y dejamos crecer hasta lo que cabe respetando aspect. Implementación en `resizeFromCorner` / `resizeFromHorizontalEdge` / `resizeFromVerticalEdge`. Si el "lado guía" (el que el cursor mueve más) excedería los bounds, se cambia al otro lado y se recalcula.

Test de regresión: `src/crop.test.ts > resizeBox — with aspect lock > SE corner with 1:1 aspect produces a square` con cursor lejos.

## UI

### Aspect ratios disponibles

Los botones se almacenan como **portrait W:H** (W < H, ej. `4:5`). Cuando la orientación es `landscape`, el módulo flippea el ratio (`a → 1/a`). Esto coincide con el editor del iPhone: una sola lista de proporciones + toggle de orientación.

Lista actual: `libre`, `original`, `1:1`, `9:16`, `8:10`, `5:7`, `4:5`, `3:4`, `3:5`, `2:3`. Si querés sumar `7:5` o `16:9` directamente, agregar el botón en `index.html` — el JS los detecta solos por `.aspect-btn[data-aspect]`.

### Overlay

DOM simple, todo en CSS:

```
#crop-overlay (absolute, sigue al canvas)
  ├── 4× .crop-shade (top/bottom/left/right) — overlay oscuro fuera del crop
  └── .crop-box
        ├── .crop-grid (rule of thirds via background-image)
        └── 8× .crop-handle (nw/n/ne/e/se/s/sw/w)
```

Las shades se posicionan con JS para envolver la box. La grid rule-of-thirds es un par de `linear-gradient` para no agregar más nodos.

### Sincronización

El overlay debe seguir al canvas en cualquier cambio de layout:

- `ResizeObserver(view)` — captura cambios de zoom (cuando JS o CSS modifican width/height).
- `viewport.addEventListener('scroll', syncOverlay)` — al hacer scroll cuando estás zoomeado.
- `window.addEventListener('resize', syncOverlay)` — al cambiar el tamaño de la ventana.

`syncOverlay()` recalcula posición + dimensiones del overlay y de cada shade. Es barato (sin layout thrashing porque escribe directo a `style`).

### Drag

Pointer events sobre `.crop-box`. Detecta si el target es un `.crop-handle` (entonces resize) o el interior (entonces `move`). El drag captura el pointer en `cropBoxEl` y escucha `pointermove` / `pointerup` en `window` para no perder el evento si el cursor sale del overlay.

Cada `pointermove` recalcula `cropBox` con `resizeBox` o `moveBox` y llama `syncOverlay()`. Sin debounce — son funciones puras y baratas.

## Aplicar / restaurar

- **Aplicar**: `cropImageData(preview, cropBox)` y `cropImageData(source, sourceBox)`. Reset zoom a fit. La imagen mostrada queda recortada y el export usará los buffers nuevos. Toast de éxito.
- **Restaurar**: reasigna `source = originalSource` y `preview = originalPreview`. La imagen vuelve completa. Si seguís en la pestaña recortar, el overlay se reposiciona al full bounds.

## Out of scope

- Rotación / flip horizontal/vertical (el editor del iPhone los tiene).
- Straighten (rotación libre con grados).
- Undo/redo de múltiples crops (ahora solo "restaurar al original").
- Constraint de aspect en el `move` (hoy el crop se mueve libre, sin pegarse a bordes).
- Resize del overlay arrastrando entre dos handles (multi-axis con shift modifier).

## Constantes (tune-points)

En `src/crop.ts`:

```ts
const MIN_SIZE = 20;   // px de imagen — tamaño mínimo del crop
```

Ese mínimo es en píxeles del preview. Para imágenes con preview típico de 1920px, 20 píxeles ≈ 1% de la imagen, suficientemente chico para no estorbar pero evita boxes degeneradas.
