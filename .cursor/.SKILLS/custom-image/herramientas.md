# custom-image — herramientas

El menú flotante de herramientas (en el código se llama `#tools`, pero conceptualmente son **las herramientas**). Aloja los cuatro modos de edición: curvas, ajustes, recortar y exportar.

## Estructura

```
#tools (fixed top-right, hidden hasta cargar imagen)
  ├── header
  │     ├── tabs (curvas / ajustes / recortar / exportar)
  │     └── botón reset (limpia todos los ajustes y curvas)
  └── panels (uno visible a la vez según el tab activo)
        ├── data-panel="curves"  → widget de curvas + selector de canal RGBA
        ├── data-panel="adjust"  → 9 sliders de ajustes (exposición, brillo, ...)
        ├── data-panel="crop"    → orientación + grid de aspect ratios + aplicar/restaurar
        └── data-panel="export"  → formato, escala, calidad y botón descargar
```

La pestaña recortar tiene su propia doc en `recortar.md` porque hay overlay en vivo + originals + sync con zoom — más complejidad que el resto.

`#tools.hidden` se controla con:
- `false` automáticamente al cargar la primera imagen
- Toggle manual con la tecla `ESC`

## Bug histórico — `[hidden]` vs `display: flex`

**Importante**: el atributo HTML `hidden` aplica `display: none` vía user-agent stylesheet. Cualquier regla CSS de autor con `display: flex/grid/block` en el mismo elemento **lo pisa** porque tienen igual especificidad y la cascada de autor gana. Esto provocaba dos bugs simultáneos:

1. Los tabs cambiaban `panel.hidden = true/false`, pero los tres paneles se veían apilados todo el tiempo.
2. El drop overlay seguía visible y clickeable después de cargar la imagen.

**Fix definitivo** en `src/style.css`:

```css
[hidden] { display: none !important; }
```

Aplica a todo el árbol. Si en el futuro alguien agrega `display: ...` a un elemento con `hidden`, sigue funcionando. **No remover esta regla.**

## Tabs

Cada `.tab` tiene `data-tab="curves|adjust|export"` y cada `.panel` tiene `data-panel` con el mismo valor. El handler:

```ts
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.tab!;
    $$('.tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== t; });
  });
});
```

Sin gimnasias. El `is-active` solo cambia colores (fondo `--accent`, texto `--bg`), no afecta visibilidad.

## Sliders (panel ajustes)

9 sliders, todos generados por convención:

```html
<input type="range" min="-100" max="100" value="0" data-adj="exposure"/>
<i data-val="exposure">0</i>
```

El handler genérico lee `data-adj` para saber qué propiedad de `state.adjust` actualizar y `data-val` para encontrar el `<i>` que muestra el valor en vivo. Agregar un slider nuevo es solo HTML — el JS lo encuentra solo.

**Las `data-adj` keys quedan en inglés** (`exposure`, `brightness`, etc.) porque son las propiedades del tipo `Adjust` en `types.ts` y del pipeline. Los **labels visibles** (`exposición`, `brillo`, ...) están en español. Si en algún momento se cambia un label en HTML, no toques el `data-adj`.

Mapeo de rangos en `pipeline.ts`:

| `data-adj`   | Label UI       | Rango UI    | Mapeo interno          |
|--------------|----------------|-------------|------------------------|
| exposure     | exposición     | -100..100   | `Math.pow(2, v/50)` (stops-ish) |
| brightness   | brillo         | -100..100   | `v * 1.27` (-127..127) |
| contrast     | contraste      | -100..100   | `1 + v/100` (0..2)     |
| highlights   | luces          | -100..100   | `v/100` (peso luma)    |
| blacks       | negros         | -100..100   | `v/100` (peso luma)    |
| saturation   | saturación     | -100..100   | `1 + v/100` (0..2)     |
| denoise      | reducir ruido  | 0..100      | `v/100` (mix box-blur) |
| noise        | añadir ruido   | 0..100      | `v * 1.27` (amplitud)  |
| noiseSat     | sat. ruido     | 0..100      | `v/100` (mono ↔ color) |

## Curvas (panel curves)

Widget montado por `mountCurves(canvas, onChange)` en `src/curves.ts`. Marcado con `/* v8 ignore */` porque es DOM puro. Maneja:
- Click en zona vacía → agrega punto
- Drag de un punto → mueve (los endpoints solo se mueven en `y`)
- Doble click en un punto interno → lo borra
- Selector de canal: `m` (master) y `r/g/b` (per-channel)

El estado se mantiene en `mountCurves` y se sincroniza con `state.curves` vía el callback `onChange`.

Pipeline: master corre antes que per-channel (los LUTs per-channel ven valores ya corregidos por master). Test de regresión en `pipeline.test.ts > apply — curves > master curve runs before per-channel`.

## Export (panel export)

Genera el archivo final corriendo `apply()` sobre la imagen `source` (full-res, capada a 4096px), no sobre `preview` (capada a 1920px). Pasos:

1. Aplicar pipeline al `source`.
2. Crear un canvas intermedio del tamaño del source procesado.
3. Crear el canvas final de salida con `naturalSize * scale` (escala 0.3x/1x/2x/4x).
4. `drawImage` del intermedio al final con `imageSmoothingQuality: 'high'`.
5. `convertToBlob` con `image/png` o `image/jpeg` + quality (solo JPG).
6. Trigger descarga con `<a download>`.

Helper `makeCanvas(w, h)` decide entre `OffscreenCanvas` (preferido) y `HTMLCanvasElement` (fallback Safari).

Toasts: muestra "Descarga lista." en éxito o el error específico si falla la conversión.

## Reset

Botón `#reset` (esquina derecha del header). Restaura `defaultAdjust()` + `defaultCurves()` y refresca todos los inputs (sliders y widget de curvas). No afecta el zoom ni la imagen cargada.

## Atajos relacionados

- `ESC` → mostrar/ocultar herramientas (solo si hay imagen cargada).

Los demás atajos son del zoom (`zoom.md`).

## Idioma

UI **en español**. Excepciones:

- `reset` (botón de reset general) — palabra universal, se queda.
- `master` (canal de curvas) — término técnico de edición de imagen.
- `r` / `g` / `b` (canales de curvas) — abreviaciones técnicas.
- `png` / `jpg` (opciones del select de formato) — extensiones.
- `1:1`, `16:9`, etc. — notación numérica.

Si agregás un string nuevo, va en español. Toasts incluidos.

## Layout — width 320px es restricción dura

`#tools` tiene `width: 320px` y `overflow: hidden`. Hay 4 tabs + el botón reset; el ancho total con padding apenas entra. Si agregás una pestaña más o un label más largo, **vas a necesitar tightear paddings o reducir font-size** porque el `overflow: hidden` va a clippear silenciosamente el contenido (en vez de ensanchar el panel).

Tunings actuales:
- `.tab` padding `10px 8px` (era `10px 14px` original; el original no entraba con 4 tabs)
- `.ghost` (reset) padding `0 10px`, `white-space: nowrap`
- font-size 12px en ambos

Si necesitás más espacio: subí el width a 360px y aflojá los paddings. No es sagrado el 320 — solo era el valor histórico.

## Estética

- Posición: `fixed; top: 24px; right: 24px; width: 320px`.
- Fondo `--panel` (#111), borde `--line` (#1e1e1e).
- Tipografía `system-ui` (cambio reciente de `ui-monospace` por algo menos "developer-aesthetic").
- Acento **gris medio oscuro** `--accent` (#6e6e6e) — tab activo, accent del slider, botón descargar, borde del crop overlay. Decisión deliberada: en lugar de un acento de color saturado (pasamos por lima #d4ff00 y rosa mexicano #ff2d87), va un gris que contrasta con el bg negro pero no compite visualmente con la imagen editada. La foto es la que tiene que llamar la atención, no el chrome.
- `--accent-soft` (`#6e6e6e33`) disponible para overlays sutiles si se necesita.
- Texto sobre el accent es `--bg` (#0a0a0a). #6e6e6e con texto negro da ratio ~4.3 — pasa AA Large (>3.0). Si en algún momento se baja el accent a algo más oscuro (ej. `#4a4a4a`), el texto sobre el botón debería cambiar a `--fg` para mantener legibilidad.
- Sin transiciones ni rounded corners — minimalismo intencional alineado con `garavito.dev` y `thirdworlds.net`.

## Out of scope

- Resize / drag de las herramientas. Hoy es estático en top-right.
- Colapsar el panel a un mini-trigger. Si las herramientas estorban se ocultan con `ESC`.
- Persistencia del tab activo entre cargas. Siempre arranca en `curves`.
