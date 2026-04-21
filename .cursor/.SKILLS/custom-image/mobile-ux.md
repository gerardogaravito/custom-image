# custom-image — mobile UX

Cómo está armada la experiencia táctil del editor. Pensado para iPhone Safari (que es el caso real del autor) pero funciona en cualquier touch device moderno gracias a Pointer Events.

## El problema que resolvemos

El modal de herramientas (320px de ancho fijo, top-right) en mobile cubre ~50% de la pantalla. La foto que estás editando queda mayormente oculta. Tres soluciones complementarias, ninguna requiere reestructurar el layout — todas son opacity + gestos:

1. **Tap-to-immerse** — un toque en la foto y todo el chrome se desvanece para verla limpia.
2. **Auto-fade al editar** — mientras arrastrás un slider, el panel baja a 50% para ver el cambio en vivo detrás.
3. **Pinch + two-finger pan** — gestos nativos para zoom y pan, los que ya tenés en músculo desde Photos.

## 1. Tap-to-immerse

Toque (touch o pen, NO mouse) en el canvas. Sin movimiento. Corto. Toggle de `body.is-immersed`. CSS:

```css
.is-immersed .tools,
.is-immersed .zoom,
.is-immersed .ab-hint {
  opacity: 0.1;
  pointer-events: none;
}
```

`pointer-events: none` es clave — mientras estás "inmerso", los toques pasan **a través** del chrome al canvas, así un segundo toque restaura el chrome aunque tu dedo aterrice donde antes había un botón.

Auto-restore después de `MOBILE_UX.immersionDurationSeconds` (default 3 s) si el usuario no toca nada. Configurable en `src/config.ts`.

### Por qué solo touch/pen, no mouse

El mouse usa click para todo (botones, sliders, toggle dropdowns). Si activáramos tap-to-immerse en mouse, cualquier click en el canvas escondería los controles — molesto. Touch usa tap para "hacer cosas con esta cosa" y los users esperan ese gesto en una foto.

Si querés un equivalente para desktop, agregar un keyboard shortcut (e.g. `f` o spacebar) que llame `toggleImmersed()` directamente.

### Discriminación tap vs drag

```ts
type TapCandidate = { x, y, t, pointerId, pointerType };
```

- En `pointerdown`: si es touch/pen y es el ÚNICO puntero activo, registramos `tapCandidate`.
- En `pointermove`: si el puntero del candidato se mueve más de `tapMaxPx` (default 8 px), invalidamos el candidato.
- En `pointerup`: si el candidato sigue válido + delta < `tapMaxMs` (default 250 ms) + no hubo multitouch en este gesto → ejecutamos toggle.

El flag `multiTouchInGesture` evita que un pinch (que termina con un dedo levantándose y luego otro) dispare un tap accidental cuando el último dedo se levanta.

## 2. Auto-fade del panel mientras editás

`flagInteraction()` (que ya tenía el rol de "burst de interacción para snapshot+save+preview interactivo") suma:

```ts
if (!isInteracting) document.body.classList.add('is-tweaking');
// ...timer end:
document.body.classList.remove('is-tweaking');
```

CSS solo aplica en mobile:

```css
@media (hover: none) {
  .is-tweaking .tools { opacity: 0.5; }
}
```

Apuntamos solo a `.tools` (no zoom bar ni hints) — el zoom es chico y abajo, los hints son efímeros, el panel grande es el único que tapa.

Desktop no se aplica porque el panel está en una esquina donde no tapa la imagen central.

## 3. Pinch + two-finger pan

Pointer Events con tracking de pointers activos en un `Map`. Cuando `activePointers.size === 2`, entramos en modo pinch.

### El cálculo (importante — está derivado matemáticamente, no inventado)

Estado al inicio del pinch (`pinch.start*`):
- `Z₀` = zoom actual
- `C₀` = punto medio entre los dos dedos (screen coords)
- `S₀` = `viewport.scrollLeft` / `scrollTop`
- `vr` = `viewport.getBoundingClientRect()` (constante durante el gesto)

Cada `pointermove` con 2 dedos calcula:
- `Z₁ = clamp(Z₀ * distance/startDistance, ZOOM_MIN, ZOOM_MAX)`
- `C₁` = nuevo center

Y aplica:
- `setZoom(Z₁)` — sin anchor, solo cambia las dimensiones del canvas.
- Scroll manual:
  ```
  S₁_x = (Z₁/Z₀) * (C₀.x + S₀.x - vr.left) - C₁.x + vr.left
  S₁_y = (Z₁/Z₀) * (C₀.y + S₀.y - vr.top)  - C₁.y + vr.top
  ```

### Por qué este cálculo, no `setZoom(z, anchor)`

`setZoom` con anchor mantiene un punto fijo bajo el cursor — funciona perfecto para wheel zoom (un evento, una posición). Para pinch:
- El "anchor" se mueve (los dedos se desplazan mientras zoomean) — pure pan sin cambio de distancia tendría que mover el centro pero `setZoom` no haría nada porque el zoom no cambió.
- `setZoom` adjusta scroll vía `requestAnimationFrame`, lo que en pointermoves rápidos puede generar conflictos con cualquier scroll que apliquemos manualmente.

La fórmula manual sale de plantear: "el píxel de imagen que estaba bajo `C₀` debe quedar bajo `C₁` después del cambio de zoom". Asumiendo overflow (que es el caso típico cuando hay pinch zoom), la posición screen del píxel de imagen `I` con zoom `Z` y scroll `S` es `vr.left - S + I*Z`. Igualando para conservar `I` da la fórmula de arriba.

Para no-overflow, el browser clampea `scrollLeft` a 0 — la fórmula puede dar negativo y simplemente no pasa nada. Acceptable.

### Coexistencia con single-finger pan

`pointerdown` con 1 dedo + canvas overflow = single-finger pan (el sistema viejo, sin tocar). `pointerdown` que lleva el conteo a 2 cancela el pan en curso (`pan = null`) y empieza el pinch.

### Coexistencia con tap

El primer `pointerdown` registra `tapCandidate` solo si NO había nadie más. Si después llega un segundo dedo, `multiTouchInGesture = true` y el tap queda invalidado. Cuando los dos dedos se levantan, no se dispara tap.

## Config

`src/config.ts` exporta `MOBILE_UX`:

```ts
export const MOBILE_UX = {
  immersionDurationSeconds: 3,  // duración del tap-to-immerse
  tapMaxMs: 250,                // tiempo máx pointerdown→pointerup para tap
  tapMaxPx: 8,                  // movimiento máx durante un tap
};
```

## 4. Phase 2 — panel al fondo en mobile (punto E)

CSS-only para reubicar `#tools` y compañía en touch devices. Cero cambios en el área de gestos.

### Layout

```css
@media (hover: none) {
  .tools {
    top: auto; right: 0; bottom: 0; left: 0;
    width: 100%;
    padding-bottom: env(safe-area-inset-bottom, 0);
    max-height: 60vh;
    overflow-y: auto;
    /* border-top only — el panel "flota" sobre el borde inferior */
  }
  .tools__bar { position: sticky; top: 0; /* + bg translucido */ }
  .zoom { bottom: auto; top: max(12px, env(safe-area-inset-top, 12px)); }
  .ab-hint { display: none; }
}
```

### Por qué cada decisión

- **bottom-anchored full-width**: pulgar alcanza naturalmente, libera el ~40% superior del viewport (donde típicamente está el sujeto). Mirror del patrón iPhone Photos / Instagram.
- **`max-height: 60vh` + `overflow-y: auto`**: la pestaña ajustes tiene 9 sliders. En landscape o teléfonos chicos, sin esto el panel desborda el viewport. Override del `overflow: hidden` base — sólo Y, X queda hidden (no horizontal scroll surprises).
- **`.tools__bar` sticky**: cuando la lista de sliders es scrolleable, las tabs tienen que quedar siempre accesibles sin scrollear arriba. Background translúcido propio para que la barra "flote" visualmente sobre el contenido scrolleado.
- **`.zoom` arriba**: la barra de zoom estaba en `bottom: 24px`. El panel ahora ocupa esa franja, así que la zoom se va al top con `safe-area-inset-top` para no chocar con notch / dynamic island.
- **`.ab-hint` `display: none`**: el hint anclaba justo debajo del panel. Con el panel ya en el fondo, "debajo" = fuera de pantalla. JS también skipea el render (`computeAbHintTop` retorna `null`), pero CSS es belt-and-suspenders por si alguien re-habilita.
- **safe-area-inset-bottom**: respeta home indicator de iOS. Sin esto, el padding inferior queda tapado por el indicator.

### JS adyacente

`src/layout.ts` exporta:

```ts
isMobileLayout(): boolean   // wrapper de matchMedia('(hover: none)'), Node-safe
computeAbHintTop(toolsBottom, isMobile, gap=8): number | null
```

`computeAbHintTop` retorna `null` en mobile → `showAbHint()` en `main.ts` early-return antes de marcar `abHintShown`. Eso permite que si el user rota desktop ↔ mobile, el hint todavía pueda aparecer una vez cuando hay espacio. Tests en `src/layout.test.ts`.

### Lo que NO se rompió

- Inmersión (Phase 1) sigue igual — sólo es opacidad.
- `.is-tweaking` auto-fade sigue igual.
- Pinch / pan / tap discrimination sin tocar.
- Desktop layout idéntico (todo dentro de `@media (hover: none)`).

## 5. Postmortem — phantom pinch en desktop

Bug detectado durante Phase 2 testing. Síntoma: en desktop, click + drag con mouse hacía un zoom out a un valor específico (ej: 45% → 19%). Reproducible incluso con la imagen en `ajustar` (sin overflow, sin pan posible). Bug preexistente — Phase 1/2 no lo causaron, sólo lo expusieron al testear más gestos.

### Causa

Dos factores combinados:

1. **`activePointers` mezclaba mouse y touch.** El check `if (activePointers.size === 2)` no discriminaba por tipo. Un mouse pointer + un pointer huérfano = size 2 → entraba al branch de pinch.
2. **No había handler de `pointercancel`.** Cuando el OS / browser cancela un gesto (system gesture, alert, force-touch del trackpad de Mac, focus loss, devtools que captura), dispara `pointercancel` en lugar de `pointerup`. Sin handler, el pointer quedaba huérfano en `activePointers` para siempre. El próximo click pareaba con el huérfano → pinch falsa → `setZoom(startZoom * distance/startDistance)` con valores arbitrarios.

### Fix

`src/gestures.ts` (testeado en `gestures.test.ts`):

```ts
export function countTouchPointers(pointers: Iterable<{ type: string }>): number {
  let n = 0;
  for (const p of pointers) if (p.type === 'touch') n++;
  return n;
}
```

`activePointers` ahora también guarda `type` (pointerType). Las decisiones de pinch usan `countTouchPointers(activePointers.values()) >= 2` en lugar de `activePointers.size`. Mouse y pen no cuentan — pinch es por definición un gesto de dedos, ningún otro device puede hacerlo de verdad.

`pinchCenterAndDistance()` también filtra a touches-only — si por algún motivo hay 3 pointers (2 touch + 1 mouse huérfano), el center/distance se calcula sólo con los 2 touches reales.

Handler nuevo de `pointercancel` (mismo flow que pointerup pero sin trigger de tap):

```ts
window.addEventListener('pointercancel', (e) => {
  activePointers.delete(e.pointerId);
  if (pinch && countTouchPointers(activePointers.values()) < 2) pinch = null;
  if (pan && activePointers.size === 0) { pan = null; view.classList.remove('is-panning'); }
  if (tapCandidate?.pointerId === e.pointerId) tapCandidate = null;
  if (activePointers.size === 0) multiTouchInGesture = false;
});
```

También se removió el outer `if (activePointers.size === 1)` del pointerdown (después del check de pinch) — si hay un huérfano, el nuevo pointer todavía debe poder iniciar pan/tap en lugar de quedar silenciosamente descartado.

### Lo que NO se rompió

Casos a verificar después de tocar el área:
- Mobile single tap → `toggleImmersed`
- Mobile pinch (2 dedos) → `countTouchPointers === 2` → entra a pinch
- Mobile single-finger pan (con overflow) → pan
- Desktop click sin overflow → ni pan, ni pinch, ni tap (correcto, no debe pasar nada)
- Desktop click+drag con overflow → pan funciona
- Desktop click+drag con orphan pointer → no más phantom pinch (fix)

## 6. Suppresión del pinch zoom nativo de iOS Safari

iOS Safari implementa su propio pinch zoom de página que **ignora** la directiva `<meta name="viewport" maximum-scale=1 user-scalable=no>` desde Safari ~10 (decisión de accesibilidad de Apple — los usuarios deben poder hacer zoom para acomodar problemas de visión).

Ese pinch nativo se dispara a través de eventos WebKit-only: `gesturestart`, `gesturechange`, `gestureend`. Estos son **independientes** de los Pointer Events que usamos para nuestra lógica de pinch — `e.preventDefault()` en `pointerdown/move` no los suprime.

### El bug que esto causa

Sin suppression de gesture events, un pinch en mobile dispara DOS cosas en paralelo:

1. **Browser page zoom**: toda la página (canvas + chrome) se ampliaba. Los elementos `position: fixed` (tools panel, zoom bar) se "desvanecían" porque salían del viewport ampliado.
2. **Nuestro custom pinch**: el handler de `pointermove` con `countTouchPointers >= 2` también corría, llamando `setZoom()` con valores arbitrarios.

Resultado visual: caos. La UI pareciera "saltar" y el zoom no respeta lo que hicimos.

### Fix

Dos partes, ambas mínimas:

**1. CSS — `touch-action: none` en `#viewport`:**

```css
#viewport { touch-action: none; }
```

Le dice al browser "yo manejo todos los gestos táctiles dentro de este elemento". Anula scroll/pan/pinch nativos por touch. **Mouse wheel sigue funcionando** — `touch-action` solo afecta input táctil. Como ya hacemos pan manual via `viewport.scrollLeft/scrollTop` en pointer handlers, no perdemos funcionalidad.

**2. JS — suppress gesture events a nivel `document`:**

```ts
['gesturestart', 'gesturechange', 'gestureend'].forEach((eventName) => {
  document.addEventListener(eventName, (e) => e.preventDefault(), { passive: false });
});
```

Por qué a nivel `document` y no `viewport`: si el usuario apoya un dedo en el menu (panel) y otro en el canvas, los gesture events salen del menu (que está fuera de `#viewport`). Suprimir a nivel document atrapa todos los casos. `passive: false` es obligatorio para que `preventDefault()` funcione.

### Por qué no `meta viewport` solo

Probamos. iOS lo ignora. Cualquier app web que necesite suprimir pinch en iOS DEBE escuchar gesture events. Es el ÚNICO mecanismo que funciona consistentemente.

### Compatibilidad

- **iOS Safari**: gesture events son la API nativa, perfecto.
- **Chrome/Firefox/otros**: no disparan gesture events. Los listeners son no-ops, sin overhead.
- **Desktop**: `touch-action` afecta solo input táctil. Mouse + trackpad scroll wheel siguen funcionando exactamente igual.

## Roadmap restante

- **F. Bottom sheet con snap points** — el panel actual es estático con `max-height: 60vh`. F sería convertirlo en un drawer drag-to-snap (collapsed / mid / full). Cambio mayor — requiere más gestos coexistiendo con pinch/pan/tap. Considerar sólo si el feedback de E pide más control.
- **G. Strip horizontal de sliders** — en pestaña ajustes mobile, reemplazar 9 sliders verticales por strip de íconos + un slider grande del ajuste activo. Estilo iPhone Photos. Rediseño del panel adjust.
- **Tap-to-immerse desktop via keyboard shortcut** — agregar `f` o spacebar al keydown handler global llamando `toggleImmersed()`. Trivial pero no implementado todavía.
- **Pinch zoom desktop via wheel** — ya está (Ctrl+wheel).

Si volvés a tocar este área, leé esto antes de mover algo — la coexistencia entre pinch / pan / tap es delicada y los flags son fáciles de descoordinar.
