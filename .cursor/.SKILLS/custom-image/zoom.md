# custom-image — zoom

Sistema de zoom y pan del canvas principal. Implementado con CSS + scroll nativo del navegador (no transform).

## Modos

- **`'fit'`** (default al cargar cualquier imagen): la foto cabe completa en el viewport. Activa CSS `max-width: 100%; max-height: 100%; width: auto; height: auto`. Sin scrollbars.
- **número** (`0.1` a `8` = 10% a 800%): zoom manual. JS setea `view.style.width` y `view.style.height` en píxeles según `naturalSize * zoom`. Cuando excede el viewport, el contenedor `#viewport` muestra scrollbars y el usuario navega scrolleando.

`view.dataset.zoomMode` controla qué CSS aplica (`fit` o `manual`). Se setea por default en el HTML para evitar un flash de tamaño natural antes de que JS corra.

## Layout

```
#stage (fixed, full viewport, overflow: hidden)
  └── #viewport (absolute inset:0, overflow: auto, display: flex, *safe center)
        ├── #view (canvas, dimensiones según modo)
        └── #crop-overlay (absolute, sigue al canvas — solo visible en modo crop)
```

**Flexbox, no grid**. Hay un bug histórico: en CSS Grid sin `grid-template` explícito, el track auto-ajusta al contenido. Si el item es un `<canvas>` con tamaño intrínseco (atributos `width`/`height`), `max-width: 100%` se interpreta como "100% del track" = "100% del canvas" = sin restricción. Resultado: el modo `'fit'` no encajaba y el canvas se renderizaba a tamaño natural, desbordando. Solo "se arreglaba" cuando el zoom seteaba un `style.width` explícito.

Con flexbox los porcentajes refieren al container (`#viewport`), que tiene dimensiones definidas vía `inset: 0`. Funciona como uno espera. Adicional: hay que setear `min-width: 0; min-height: 0` en el canvas porque flex items por default tienen `min: auto` (no se encogen debajo del contenido intrínseco).

**`safe center`** es clave: cuando el canvas cabe lo centra; cuando excede, salta a alineación al borde para que el scroll pueda llegar al top/left. Centrado simple bloquea el scroll por encima de 0 (era el bug que cortaba imágenes verticales).

## Inputs

| Input                       | Acción                                  |
|-----------------------------|-----------------------------------------|
| Botón `−`                   | Zoom out × 1.25                         |
| Botón `+`                   | Zoom in × 1.25                          |
| Botón `ajustar`             | Volver a fit-to-screen                  |
| Botón `1:1`                 | Tamaño real (zoom = 1)                  |
| Tecla `+` / `=`             | Zoom in × 1.25                          |
| Tecla `-` / `_`             | Zoom out × 1.25                         |
| Tecla `0`                   | Fit-to-screen                           |
| Tecla `1`                   | Tamaño real                             |
| `Ctrl/Cmd + wheel`          | Zoom alrededor del cursor (proporcional)|
| `click + drag` sobre canvas | Pan (mover viewport sin cambiar zoom)   |

Las teclas se ignoran cuando el foco está en `INPUT/TEXTAREA/SELECT/contentEditable` (los sliders no se rompen). El wheel sin modificador hace scroll vertical normal — convención de navegador, no la pisamos.

## Pan (drag-to-scroll)

Cuando el canvas excede el viewport (zoom in), `click + drag` sobre el canvas mueve el viewport. El cursor cambia automáticamente:

- `cursor: grab` cuando hay overflow scrollable y no estás en modo crop (clase CSS `.is-pannable` aplicada por JS).
- `cursor: grabbing` mientras estás efectivamente arrastrando (clase `.is-panning`).
- `cursor: default` cuando el canvas cabe entero (no hay nada que pan).

`updatePannableState()` corre después de cada cambio de zoom (`requestAnimationFrame` para que `scrollWidth/Height` ya reflejen el nuevo layout) y al `resize` de la ventana. También se llama al entrar/salir del modo crop, porque crop tiene su propia interacción con el canvas.

El pan usa `pointer events` con `setPointerCapture` para no perder el drag si el cursor sale del viewport. La lógica simplemente trackea la diferencia de coords del cursor desde `pointerdown` y la aplica como delta inverso al `viewport.scrollLeft/Top`.

**Conflicto evitado**: en modo crop, los pointer events sobre el canvas pasan a la overlay (z-index encima), así que el handler de pan no se dispara. Adicional guard `if (cropActive) return` por defensa.

## Sensibilidad del wheel

Trackpad emite muchos eventos chiquitos (`deltaY ~3`); el mouse manda eventos grandes (`deltaY ~100`). Un step fijo se siente híper-sensible en trackpad y lento en mouse.

Solución: factor exponencial proporcional a la magnitud del gesto.

```ts
let factor = Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY); // sens = 0.0015
factor = clamp(factor, 1 / ZOOM_WHEEL_PER_EVENT_CAP, ZOOM_WHEEL_PER_EVENT_CAP);
```

- Mouse, un click (`deltaY = 100`): `factor ≈ 0.86` → ~14% por click.
- Trackpad, un evento (`deltaY = 4`): `factor ≈ 0.994` → ~0.6% por evento, suma suave durante el gesto.
- El cap por evento (1.15) evita que un solo click monstruoso pegue un brinco.

Si en algún momento se siente demasiado lento o demasiado rápido, ajustar `ZOOM_WHEEL_SENSITIVITY` en `main.ts`. Subirlo = más sensible.

## Zoom alrededor del cursor

Al hacer `Ctrl/Cmd + wheel`:

1. Antes de cambiar `zoomMode`, calculamos la coordenada de imagen bajo el cursor: `imgPoint = (clientPos - canvasRect) / currentZoom`.
2. Aplicamos el nuevo zoom.
3. En el siguiente `rAF` (cuando el layout ya respondió al nuevo `style.width/height`), ajustamos `viewport.scrollLeft/Top` para que `imgPoint * newZoom` quede otra vez bajo el cursor.

Sin el `rAF` el scroll se aplica con dimensiones viejas y el punto se desplaza.

## Indicador de zoom

`#zoom-level` muestra el porcentaje efectivo. En modo `'fit'` calcula el factor real (`Math.min(viewportW/naturalW, viewportH/naturalH, 1)`), por eso una foto vertical en una pantalla wide muestra algo como `47%` — es correcto.

`font-variant-numeric: tabular-nums` evita que el ancho del indicador salte mientras se hace zoom (los dígitos tienen ancho fijo).

## Reset al cargar imagen nueva

`loadImage()` siempre llama `setZoom('fit')` después de generar el preview, así el usuario empieza viendo la foto completa sin importar el estado anterior. Después de `schedule()`, un `rAF` adicional refresca el label porque el porcentaje "fit" depende de las dimensiones intrínsecas del canvas, que se setean dentro del `rAF` del schedule.

## Mobile: pinch-zoom del browser deshabilitado

El `<meta name="viewport">` incluye `maximum-scale=1.0, user-scalable=no`. Esto deshabilita el pinch-to-zoom **nativo del navegador** sobre la página. Trade-off consciente:

**Por qué**: durante un pinch nativo, los elementos `position: fixed` (zoom bar, tools panel) flotan en posiciones extrañas y a veces salen de la pantalla durante el gesto. Como tenemos nuestro propio sistema de zoom completo (botones, atajos, wheel), permitir el pinch del browser arriba duplica funcionalidad y rompe layout.

**Trade-off de a11y**: usuarios con baja visión que dependen del pinch del browser para magnificar el sitio no podrán hacerlo. En este caso aceptado porque (a) el contenido principal es una imagen, no texto, (b) tenemos zoom propio explícito con botones grandes y atajos, (c) el chrome tiene tamaños tipográficos cómodos por defecto.

`#zoom` también tiene `z-index: 50` (más alto que tools=10 y crop overlay=5) para garantizar que esté siempre arriba.

## Constantes (tune-points)

Todas en `src/main.ts`:

```ts
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;                 // botones / teclado
const ZOOM_WHEEL_SENSITIVITY = 0.0015;  // wheel: subir = más sensible
const ZOOM_WHEEL_PER_EVENT_CAP = 1.15;  // brinco máximo por evento
```

## CSS de detalle

- `image-rendering: pixelated` cuando `zoomMode = 'manual'` para ver los píxeles nítidos al hacer zoom in.
- `image-rendering: auto` en `fit` para que el downscaling se vea suave.
- Scrollbars finos con `scrollbar-width: thin` (Firefox) y `::-webkit-scrollbar` (Chromium/Safari) usando los colores del tema.

## Out of scope (no implementado)

- Pan con drag del mouse (sin scrollbars). Hoy se navega con scroll del trackpad o las barras laterales. Si se quiere drag-to-pan, agregar un handler `pointerdown/move/up` en `#viewport` que actualice `scrollLeft/Top`.
- Pinch zoom (gesto de dos dedos en trackpad sin Ctrl). El navegador ya maneja eso a nivel página; si se quiere capturarlo a nivel canvas, escuchar el evento `wheel` con `e.ctrlKey === true` (los browsers reportan pinch como `wheel + ctrl`).
- Persistencia del nivel de zoom entre cargas. Hoy siempre se resetea a `'fit'`.
