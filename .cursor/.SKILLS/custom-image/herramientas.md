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

### Doble click sobre el valor → toggle A/B

El `<i data-val>` tiene `cursor: pointer` y un `:hover` que lo pinta con accent — son pistas visuales.

**Comportamiento**: cada slider mantiene un `previousValue.get(key)` (Map) con el valor justo ANTES del último burst de interacción. El doble click hace **swap entre el valor actual y ese previo** — pestañear entre dos posiciones para A/B compare. Después del swap, el valor anterior se actualiza al que estaba antes, así un segundo doble click vuelve al primero.

Inicialización: `previousValue` arranca con los defaults para todas las keys, así un doble click sin haber editado nada actúa como reset al default (caso degenerado pero útil).

Tracking del previous value: en el handler `input` del slider, **antes** de aplicar el cambio nuevo, si `!isInteracting` (primer evento del burst) se guarda `state.adjust[key]` actual en el Map. Las llamadas subsiguientes del mismo drag NO sobreescriben (porque ya estamos en burst). Cuando el burst termina (después de `INTERACTION_RELEASE_MS`), `isInteracting` vuelve a false; el siguiente input arranca un nuevo burst y guarda el valor pre-burst.

El swap también pushea undo + dispara save — consistente con cualquier otro cambio.

### Divider antes de los sliders de ruido

`<hr class="sl-divider" />` separa visualmente saturación de los tres sliders de ruido (denoise / noise / noiseSat) porque conceptualmente son otra familia. Es solo CSS (border-top + margins), sin JS. Si agregás más grupos, replicar el patrón.

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

## Export (panel exportar)

Genera el archivo final corriendo `apply()` sobre la imagen `source` (full-res, capada a 4096px), no sobre `preview` (capada a 1920px). Pasos:

1. Aplicar pipeline al `source`.
2. Crear un canvas intermedio del tamaño del source procesado.
3. Crear el canvas final de salida con `naturalSize * scale` (escala 0.3x/1x/2x/4x).
4. `drawImage` del intermedio al final con `imageSmoothingQuality: 'high'`.
5. `convertToBlob` con `image/png` o `image/jpeg` + quality (solo JPG).
6. Trigger descarga con `<a download>` usando el nombre derivado por `nextDownloadName()`.

Helper `makeCanvas(w, h)` decide entre `OffscreenCanvas` (preferido) y `HTMLCanvasElement` (fallback Safari).

### Naming del archivo descargado

`{sourceName}_NN.{ext}` — primer download = `_01`, segundo = `_02`, etc., con padding de 2 dígitos. El sufijo lo lleva un `Map<string, number>` indexado por `sourceName`, persistente toda la sesión.

**Limitación**: el navegador **no puede inspeccionar el filesystem del usuario** (sandbox). Si en el disco ya existe `Photo_01.png` de una sesión anterior, vamos a generar otro `Photo_01.png` y el navegador típicamente lo nombrará `Photo_01 (1).png` por su lógica de "Save As". No hay forma de evitarlo desde JS sin la File System Access API (Chromium-only + permisos), que sería overkill para este editor.

El counter no se resetea al cargar una imagen nueva: si subís otra foto distinta, su `sourceName` no estará en el Map y arranca en `_01`. Si recargás la misma imagen en la misma sesión, continúa donde estaba.

### Destino del archivo: Photos (iOS) / Pictures (Android) / Downloads (desktop)

`saveImage(blob, filename)` routea por **plataforma**, no solo por touch. iOS y Android tienen capacidades muy distintas para este flujo y meterlos en la misma rama (como hacíamos antes) genera el bug clásico de "el botón descargar no me guardó la foto en mi galería" en Android.

Detección via UA + `maxTouchPoints` (`isIOSDevice`, `isAndroidDevice` declaradas top-level en `main.ts`). Sí, UA sniffing es feo, pero las APIs no nos dan otra forma de distinguir iOS Safari de Android Chrome cuando ambos son `(hover: none)`.

Tres caminos:

1. **iOS** → **Web Share API** (`navigator.share({ files })`). El share sheet de iOS tiene una acción nativa **"Guardar imagen"** que escribe directo al carrete de Photos. Es **la única vía web** para que el archivo termine ahí — `<a download>` solo lo manda a Files/Descargas, donde la app Fotos no lo ve.
2. **Android con `showSaveFilePicker`** (Chromium ≥ 86, Edge, Brave, Samsung Internet ≥ 14) → **File System Access API**. Abre un picker nativo con `startIn: 'pictures'` para sugerir la carpeta `Pictures/`, que **sí es indexada por Google Photos**. El browser recuerda la última carpeta elegida, así que la fricción es one-time. El `suggestedName` ya viene con el `_NN` de `nextDownloadName()`. Retorna `'saved'`.
3. **Fallback** (Android Firefox / cualquier browser sin Web Share ni FSA / desktop) → `<a download>` tradicional → carpeta `Descargas` del browser. Retorna `'downloaded'`.

### Por qué NO usamos Web Share en Android

Esto es el corazón del bug que llevó a este split. En Android, el share sheet del sistema lista **apps instaladas con intent filter para `image/*`** — WhatsApp, Telegram, Drive, Gmail, etc. **No existe una acción nativa "Guardar en Galería"** equivalente a la de iOS. El usuario ve un grid de apps, no encuentra "fotos/galería", y termina mandándolo a Drive o cancelando. Percepción: "el botón descargar no funciona".

Aún si el usuario eligiera "Files" en el share sheet, el archivo iría a `Descargas/`, que **Google Photos NO escanea por default** (solo escanea `DCIM/Camera` y carpetas explícitamente marcadas como "device folders"). La galería del fabricante (Samsung Gallery, MIUI Gallery) sí suele escanear `Descargas/`, pero Google Photos — la app "Fotos" del usuario promedio Android — no.

Por eso en Android saltamos directo a `showSaveFilePicker`, que sí permite escribir a `Pictures/` (carpeta estándar que Google Photos indexa).

### Por qué `showSaveFilePicker` y no, p. ej., un OPFS/IndexedDB cache

`showSaveFilePicker` es la única API web estándar que escribe **al filesystem real del usuario en una ubicación elegible por él**. OPFS es una sandbox virtual del browser, invisible a otras apps. La File System Access API requiere un user gesture (lo tenemos: el click en `#download` es el trigger) y el browser delega el path al usuario, así que no hay riesgo de seguridad ni permisos extra.

### Toasts según el camino

- `'shared'` (iOS share sheet completado) → `'imagen guardada'`
- `'saved'` (Android FSA picker completado) → `'imagen guardada'`
- `'downloaded'` en **Android** → `'guardada en Descargas — moverla a Pictures para verla en Fotos'` con `durationMs: 6000` (es información accionable, vale el extra de tiempo en pantalla)
- `'downloaded'` en **desktop / otros** → `'descarga lista'`
- `'cancelled'` (usuario cierra el share sheet o el save picker) → sin toast (evita ruido)

### Errores y fallthrough

Tanto `navigator.share` como `showSaveFilePicker` rechazan con `AbortError` si el usuario cancela. Cualquier otro error (`SecurityError`, `NotAllowedError`, sharing failure por permisos rotos, etc.) cae al `<a download>` final. El usuario siempre termina con un archivo en algún lado — nunca se queda sin nada.

### Anti-patrón evitado

La versión antigua hacía `if (matchMedia('(hover: none)').matches && canShare)` indiscriminadamente para cualquier touch device. Eso funcionaba en iOS y rompía silenciosamente la expectativa de los usuarios Android. Ahora la rama Web Share está **gated por `isIOSDevice`** explícito.

Si en algún momento Web Share API en Android añade una opción nativa "Save to Gallery" (no parece probable a corto plazo — la propia spec lo deja en manos del OS), volver a evaluar el split.

### Override por query param para testing

`?platform=ios|android|desktop` en la URL fuerza el branch correspondiente sin importar el dispositivo real. Sigue el mismo precedente del `?debug=1` HUD documentado en `mobile-ux.md` postmortem #7. Útil para:

- Testear el flujo Android (`?platform=android`) desde Chromium desktop sin un handset real — `showSaveFilePicker` está disponible nativamente en Chrome/Edge/Brave desktop, así que el picker de `Pictures/` se dispara igual.
- Testear el fallback `'guardada en Descargas...'` toast (Android Firefox path) desde un browser desktop sin la API.
- Verificar que el flujo iOS (`?platform=ios`) cae al fallback `<a download>` cuando `canShare` no está disponible (desktop).

Implementación: las dos constantes `isIOSDevice` y `isAndroidDevice` consultan primero `URLSearchParams(location.search).get('platform')`. Si está, ganan; si no, detección normal por UA + `maxTouchPoints`. Nunca un usuario real va a tipear el query param — es zero-risk en producción.

Las constantes se evalúan **una sola vez al cargar el módulo**. Cambiar el query param requiere recargar la página. Mismo limite si haces UA spoofing via DevTools.

### Cookbook — matriz de validación desde Chrome desktop

Sin tocar un device real, los cuatro caminos de `saveImage` se cubren así:

| Caso a validar | Setup | Resultado esperado |
|---|---|---|
| Android con FSA (Chromium) | `?platform=android` | Picker nativo `Save As` abierto en `Pictures/` con el filename pre-cargado. Confirmar → toast `'imagen guardada'`. Cancelar → sin toast. |
| Android sin FSA (Firefox / Samsung Internet viejo) | `?platform=android` + en consola: `delete window.showSaveFilePicker` antes de cliquear descargar | Cae a `<a download>` clásico + toast `'guardada en Descargas — moverla a Pictures...'` durante 6 s. |
| iOS share sheet | Necesita Safari (mac 16.4+ o iPhone). Chrome desktop no tiene `canShare`, así que cae al fallback. | Safari mac: share sheet. Chrome desktop con `?platform=ios`: fallback `<a download>` + toast `'descarga lista'`. |
| Desktop normal | Sin query param o `?platform=desktop` | `<a download>` + toast `'descarga lista'`. |

Validado manualmente en abril 2026 (Chrome 124 macOS) — los cuatro caminos pasan, incluido el sub-caso del `delete window.showSaveFilePicker` que confirma que el toast educativo de Android se muestra correctamente cuando la API no está disponible.

## Reset (con undo)

Botón `#reset` (esquina derecha del header). Restaura `defaultAdjust()` + `defaultCurves()` y refresca todos los inputs (sliders y widget de curvas). No afecta el zoom ni la imagen cargada.

Pushea un snapshot al `undoStack` antes de aplicar y muestra un toast con un botón "undo" inline. Si el reset fue accidental, click en "undo" o `Cmd+Z` lo revierte. Ver `undo.md` para la mecánica completa.

## Mostrar / ocultar herramientas

El panel se cierra en cualquiera de estas formas:

- Botón **"menu"** dentro de la barra de zoom (fixed, abajo al centro). Cambia a "ocultar" cuando el panel está visible. Toca en mobile (sin pretensión, fácil de alcanzar) y click en desktop.
- `ESC` en desktop.

`setToolsHidden(hidden: boolean)` es la única función que muta `tools.hidden`, así el label del botón se mantiene sincronizado siempre.

**Importante**: `setToolsHidden` también esconde el **crop overlay** cuando el panel se oculta (si el usuario estaba en modo crop). Sin esto, el rectángulo con la regla de tres seguía flotando sobre la imagen sin la UI que lo controla. Al re-mostrar el panel, restaura el overlay y llama `syncOverlay()` por si hubo resize/scroll mientras estaba oculto.

### Hint de ESC al primer render (desktop only)

`maybeShowEscHint()` se llama dentro de `loadImage()` justo después de mostrar las herramientas por primera vez. Muestra un toast discreto `"ESC para ocultar el menú"` por 5 segundos.

Reglas:
- Solo desktop (`matchMedia('(hover: hover)')`). En mobile la gente no tiene teclado, además el botón "menu" en la zoom bar ya está visible y es obvio.
- **Solo una vez por sesión** (flag `escHintShown`). El propósito es discoverability del shortcut, no nag al usuario.
- Si recargás la página el flag se resetea — lo verás otra vez en la próxima sesión.

## Cambiar imagen sin recargar

Botón `#change-image` en un dropdown que aparece debajo de `#reset` al hacer hover (desktop) o siempre visible (mobile, `@media (hover: none)`). Click llama `file.click()` que dispara el mismo file picker del drop zone.

CSS: `.reset-group` es el wrapper, `.reset-group__menu` el dropdown — `position: absolute; top: 100%`. Hover y `:focus-within` lo despliegan con un fade-in suave (120ms). En touch devices se queda visible permanentemente porque hover no existe ahí.

**Bug histórico — focus stickiness**: al clickear el botón se le daba foco; `:focus-within` mantenía el dropdown abierto indefinidamente, incluso si el usuario cancelaba el file picker. **Fix**: el handler llama `e.currentTarget.blur()` después de `file.click()`. Sin esto, el menú quedaba pegado hasta que el usuario clickeara en otro lado.

**Nota técnica**: el handler `file.value = ''` en el listener de `change` ya manejaba el caso de seleccionar el mismo archivo dos veces. Cambiar imagen solo reusa esa infra — no necesita lógica nueva.

## Atajos relacionados

- `ESC` → mostrar/ocultar herramientas (solo si hay imagen cargada).
- `Cmd/Ctrl + Z` → undo (ver `undo.md`).
- `Cmd/Ctrl + Shift + Z` → redo.

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

## Mobile: panel translúcido

En touch devices (`@media (hover: none)`) los paneles flotantes (`.tools` y `.zoom`) usan `backdrop-filter: blur(16px) saturate(140%)` con background `rgba(17, 17, 17, 0.72)`. Efecto frosted glass estilo iOS — el usuario sigue viendo la imagen detrás del menú mientras edita.

**En desktop no se aplica** (`hover: hover` no matchea el media query). La pantalla tiene espacio de sobra, el panel ocupa solo 320px, y la imagen se ve bien al lado. Mantener el fondo sólido en desktop evita pérdida de contraste innecesaria.

Firefox soporta `backdrop-filter` desde v103 (julio 2022). Browsers más viejos caen al `background: rgba(...)` solo (semi-transparente sin blur) — no óptimo pero sigue siendo más legible que el fondo sólido ocupando la vista.

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
