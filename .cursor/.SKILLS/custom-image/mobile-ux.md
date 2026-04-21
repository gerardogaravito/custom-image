# custom-image — mobile UX

Cómo está armada la experiencia táctil del editor. Pensado para iPhone Safari (que es el caso real del autor) pero funciona en cualquier touch device moderno gracias a Pointer Events.

## El problema que resolvemos

El modal de herramientas (320px fixed, top-right) en mobile cubría ~50% de la pantalla. Foto mayormente oculta. La solución actual es un modelo **image-first**: el editor bootea con el menú oculto y la foto a pantalla completa, igual que Lightroom Mobile / Apple Photos. El menú aparece on-demand vía tap, y se auto-oculta apenas el usuario hace gestos sobre la foto (drag o pinch).

Componentes de la experiencia táctil actual:

1. **Modelo image-first (§ 7)** — menú oculto por default, tap-to-toggle, drag/pinch auto-hide. Reemplaza al tap-to-immerse temporal de Phase 1 (§ 1, ahora obsoleto) y al panel-al-fondo de Phase 2 (§ 4, ahora obsoleto).
2. **Auto-fade al editar (§ 2)** — mientras arrastrás un slider, el bottom sheet baja a 50% para ver el cambio detrás.
3. **Pinch + two-finger pan (§ 3)** — gestos nativos para zoom y pan, en músculo desde Photos.
4. **Suppression del pinch nativo de iOS (§ 6)** — sin esto, iOS dispara su pinch de página por encima del nuestro.

## 1. Tap-to-immerse — OBSOLETO (reemplazado por § 7)

> Phase 1 implementaba un toggle temporal de `body.is-immersed` que ocultaba todo el chrome 3 s y se restauraba solo. Phase 3 reemplazó esto por un toggle persistente de `body.is-menu-hidden` con default-hidden en mobile (ver § 7). El comentario sobre tap vs drag y el flag `multiTouchInGesture` siguen siendo relevantes — el tap callback ahora dispara `toggleMobileMenu()` en lugar de `toggleImmersed()`. Se conserva esta sección por contexto histórico.

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
  tapMaxMs: 250,    // tiempo máx pointerdown→pointerup para tap
  tapMaxPx: 8,      // movimiento máx durante un tap
  dragHidePx: 30,   // movimiento que dispara auto-hide del menú (§ 7)
};
```

Notar que `immersionDurationSeconds` se removió en Phase 3 — el menú ya no se restaura solo, queda oculto hasta que el usuario lo invoque con tap (o ESC en desktop).

## 4. Phase 2 — panel al fondo en mobile (punto E) — OBSOLETO (reemplazado por § 7)

> Phase 2 movió `#tools` entero al fondo como un panel scrolleable de 60vh. Phase 3 lo desarmó: ahora `.tools__bar` (tabs + reset) vive arriba pegado al zoom bar y el panel activo (`.panel`) vive abajo como bottom sheet de 50vh. Todo el resto de Phase 2 sigue en pie (zoom arriba, ab-hint hidden, safe-area, sticky tabs en su nueva posición). Se conserva esta sección por contexto histórico.

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
- Mobile single tap → `toggleMobileMenu()` (Phase 3, antes era `toggleImmersed`)
- Mobile pinch (2 dedos) → `countTouchPointers === 2` → entra a pinch + auto-hide del menú (§ 7)
- Mobile single-finger pan (con overflow) → pan + auto-hide del menú al cruzar `dragHidePx` (§ 7)
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

## 7. Phase 3 — modelo image-first

Reemplaza Phase 1 (tap-to-immerse temporal) y Phase 2 (panel al fondo). El editor mobile bootea con la foto a pantalla completa y el menú oculto. La intención: en mobile el espacio es escaso, la foto es el contenido, todo lo demás es chrome on-demand.

### Estado y máquina

Una sola fuente de verdad: `body.is-menu-hidden`.

```text
                          ┌──────────────────┐
                          │  loadImage() →   │
                          │  setToolsHidden  │
                          │   (isMobile)     │
                          └────────┬─────────┘
                                   ▼
       ┌─────────────────┐    tap canvas    ┌─────────────────┐
       │   menu HIDDEN   │ ◄──────────────► │  menu VISIBLE   │
       │ (default mobile)│                   │  (tabs + sheet) │
       └─────────────────┘                   └─────────────────┘
            ▲    ▲                                ▲    │
            │    │                                │    │ drag > 30 px
            │    │                                │    │ pinch (≥ 2 touches)
            │    │                                │    │
            │    └── tap "menu" / ESC ────────────┘    │
            └────────────────────────────────────────── ┘
```

Transitions:
- **Tap en canvas** (mobile): toggle. Funciona en ambas direcciones.
- **Drag > `MOBILE_UX.dragHidePx`** (default 30 px) en canvas: hide. Threshold > `tapMaxPx` (8 px) para que un tap shaky no oculte sin querer.
- **Pinch (≥ 2 touch pointers)**: hide al entrar al modo pinch. "Estás zoomeando, fuera del medio".
- **Botón "menu" o ESC**: toggle. Único camino para mostrar el menú durante crop mode (donde los gestos de canvas están bloqueados).

Crop mode bloquea todos los gestos sobre el canvas (`if (cropActive) return` en `pointerdown`), así que tap/drag/pinch no esconden el menú durante un recorte. El usuario sigue teniendo el botón "ocultar"/"menu" como escape.

### Layout CSS

`.tools` se vuelve un contenedor lógico sin presencia visual en mobile (`background: transparent`, `border: none`, `position: static`). Sus dos hijos se posicionan independientemente con `position: fixed`:

- **`.tools__bar`** (tabs + reset): top, justo debajo del zoom bar (`top: calc(safe-area-top + 44px)`), full-width, slim translúcido.
- **`.panel`** (la pestaña activa): bottom, full-width, `max-height: 50vh`, `overflow-y: auto`. Las pestañas inactivas siguen con `hidden` attribute → `display: none`, así sólo una vive en pantalla.
- **`.zoom`**: queda en el top como en Phase 2, **siempre visible** incluso con menú oculto. Es feedback constante del estado y entry-point al menú vía botón "menu".

Estado `is-menu-hidden`: `opacity: 0; pointer-events: none; transform: translateY(±8px)` en `.tools__bar` y `.panel`. La transición es 200 ms. Pointer-events: none deja que los toques pasen al canvas debajo.

### Por qué la opacidad fade y no display: none

Tres razones:
1. **Animación** — `display: none` no transiciona, el menú aparecería/desaparecería abrupto.
2. **Continuidad** — los listeners de los sliders / inputs siguen vivos, no hay teardown ni re-mount.
3. **Pointer-events: none** asegura que el menú "fantasma" no roba toques cuando está oculto.

Trade-off: el DOM siempre está renderizado. En mobile esto cuesta poco (~100 elementos de slider, todos optimizados por el browser). Si fuera un performance issue, conmutar a un componente lazy-mounted; hoy no es problema.

### Por qué auto-hide en drag/pinch en lugar de quedarse ahí

UX heurística estándar de editores foto-mobile (Lightroom, VSCO, Snapseed): cuando el usuario gestiona la imagen (zoomear, mover), el chrome estorba. Acción del usuario en la foto = "déjame ver la foto sin distracción". Threshold conservador (`dragHidePx: 30`, ~3 mm en una pantalla de iPhone) para que sólo se dispare en intención clara.

### Por qué el threshold de drag es > tapMaxPx pero no demasiado

- `tapMaxPx = 8`: zone de tolerancia para que un tap con dedo shaky cuente igual.
- `dragHidePx = 30`: ya es claro que el usuario está moviendo, no tapeando.

Si fuera igual a `tapMaxPx` (8), un tap apenas-shaky ocultaría el menú, frustrante. Si fuera demasiado alto (e.g. 100), el menú quedaría visible durante una parte considerable del drag, tapando el preview.

### `setToolsHidden(hidden)` despacha por layout

```ts
function setToolsHidden(hidden: boolean) {
  if (isMobileLayout()) {
    document.body.classList.toggle('is-menu-hidden', hidden);
  } else {
    tools.hidden = hidden;
  }
  // crop overlay + ab-hint + label sync
}

function isMenuHidden(): boolean {
  if (isMobileLayout()) return document.body.classList.contains('is-menu-hidden');
  return tools.hidden;
}
```

Mobile usa la body class (porque queremos opacidad y los hijos quedan en el DOM), desktop usa el `hidden` attribute del `<section>` entero (display:none, sin transición — el panel está en una esquina, animarlo es ruido). El ESC handler y el botón "ocultar" llaman a `setToolsHidden(!isMenuHidden())` y por ende funcionan en ambos layouts.

### Default state al cargar imagen

`loadImage()` y `restoreSession()` ahora hacen `setToolsHidden(isMobileLayout())`. Mobile: hidden. Desktop: visible. Es el momento que define el "default" de la sesión — todo gesto posterior es una transición desde ese estado.

### Sin auto-restore

Phase 1 tenía un timer (3 s) que volvía a mostrar el chrome. Phase 3 no — quitar el chrome es una intención persistente, no un peek temporal. Restaurar requiere acción explícita (tap, ESC, botón). Esto es coherente con cómo se comporta la mayoría de apps mobile (Photos no auto-restaura el bottom strip al pasar 3 s).

### Postmortem — bugs detectados después del deploy inicial de Phase 3

Seis bugs salieron al testear en iPhone real. Fix en el mismo commit que el doc.

**1. El menú no aparecía aunque cliquearas "menu"**

Causa: `<section id="tools" class="tools" hidden>` arranca con el atributo `hidden` en el HTML. Mi `setToolsHidden` mobile sólo togglea `body.is-menu-hidden` y nunca tocaba `tools.hidden`. Resultado: `tools.hidden` quedaba `true` para siempre en mobile → `display: none` en la `<section>` → los hijos `position: fixed` (bar y panel) **nunca renderizaban**, sin importar lo que hiciera el body class.

Fix: en el branch mobile, forzar `tools.hidden = false` antes de tocar la clase. Mobile usa la clase para visibilidad, no el atributo. Branch desktop limpia la clase del body por las dudas (rotación / resize cambia layout).

```ts
function setToolsHidden(hidden: boolean) {
  if (isMobileLayout()) {
    tools.hidden = false;            // crítico — sin esto el HTML hidden gana
    document.body.classList.toggle('is-menu-hidden', hidden);
  } else {
    document.body.classList.remove('is-menu-hidden');
    tools.hidden = hidden;
  }
  // …
}
```

**2. Scroll horizontal accidental al mover sliders**

Causa: `.tools__bar` con `position: fixed; left: 0; right: 0` (full viewport width) tiene `display: flex` con 4 tabs + reset + dropdown permanente (`hover: none` mantiene "cambiar imagen" siempre visible). En iPhones chicos el ancho natural del contenido excedía el viewport, generando scroll horizontal en el body. Cuando el usuario intentaba arrastrar un slider con el dedo, el browser interpretaba el gesto horizontal como pan del body antes de llegar al `<input type="range">`.

Fix: clamp del ancho a `max-width: 320px` en `.tools__bar` y `.panel`, centrados con `left: 0; right: 0; margin-inline: auto`. Coincide con el ancho fijo del panel desktop (320 px) y nunca excede el viewport.

> Nota: la versión inicial del fix usaba `left: 50%; transform: translateX(-50%); width: min(100vw, 320px)`. Se cambió a margin-based centering por bug #5 (ver abajo) — `transform` ahora se reserva exclusivamente para la animación de slide.

**3. Pinch sobre el chrome explotaba la UI a tamaño absurdo**

Síntoma: un pinch que aterrizara sobre `.tools__bar`, `.panel` o `.zoom` (todos `position: fixed` fuera de `#viewport`) hacía que iOS Safari escalara la página entera. El chrome (que vive como `position: fixed`) quedaba renderizado a tamaño grotesco, mientras el canvas (intrinsic pixels) se mantenía a su tamaño real. Resultado: tabs y zoom bar ocupaban media pantalla, sliders empujados fuera del viewport visual, panel "desaparecido".

Causa: § 6 había aplicado `touch-action: none` SÓLO a `#viewport`. El chrome quedó sin protección — ahí iOS sí dispara su pinch nativo. La suppression document-level de `gesturestart/change/end` (§ 6) es belt-and-suspenders pero no siempre llega antes que el motor de zoom de WebKit empiece a escalar.

Fix: `touch-action` explícito en cada elemento del chrome:

```css
.tools__bar, .zoom { touch-action: none; }   /* tap funciona, pinch no */
.panel            { touch-action: pan-y; }   /* permite scroll vertical interno */
```

`touch-action` afecta sólo gestos, no eventos `click` — los buttons siguen funcionando con tap. `.panel` necesita `pan-y` para que el scroll interno (cuando los sliders desbordan en landscape) siga andando; los `<input type="range">` adentro funcionan con su propia lógica de pointer events, indiferente al touch-action del padre.

Defensa adicional en `html, body`:

```css
-webkit-text-size-adjust: 100%;
text-size-adjust: 100%;
```

Evita que iOS auto-resize texto en chrome `position: fixed` cuando el sistema tiene "Larger Text" en accesibilidad, o cuando un (residual) page-zoom escapa los handlers anteriores.

**4. Tap-to-hide se quedaba en "muy transparente" pero no escondía**

Síntoma: el panel se ponía a opacidad muy baja pero seguía interceptando toques / tapando visualmente la imagen. Causa primaria: bug #1 — el `<section>` con `hidden` attr nunca renderizaba, pero el fade no era observable porque no había nada que esconder; el usuario lo describía como "transparente" probablemente al ver el último frame antes de que el class lo apagara visualmente.

Refuerzo defensivo independiente del fix: además de `opacity: 0` y `pointer-events: none`, agregar `visibility: hidden` con transición `0s linear 160ms` (delay = duración del fade). El elemento queda categóricamente fuera del árbol visible una vez completado el fade — no más estado intermedio "casi invisible pero ahí".

```css
.is-menu-hidden .tools__bar {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transform: translateY(-8px);
  transition: opacity 160ms ease, transform 160ms ease,
              visibility 0s linear 160ms;
}
/* Show side: visibility instantáneo (0s linear 0s) para que el fade-in se vea desde el primer frame. */
```

También bajé la duración del fade de 200 ms → 160 ms — el "snap" se siente más responsivo en mobile sin perder la animación.

**5. Doble-tap en Recortar disparaba el zoom de iOS · panel sin contenido**

Síntoma A: con la pestaña Recortar activa, un doble-tap (sobre el crop overlay, los botones de aspect ratio o el chrome) hacía que iOS Safari escalara la página entera, igual que el bug #3 pero por una vía distinta — el doble-tap-zoom, no el pinch.

Síntoma B (relacionado): al mostrar el menú, sólo aparecía el bar de tabs en la parte de arriba, pero el contenido del panel (sliders, botones de aspect, etc.) no renderizaba abajo.

Causa A: bug #3 había bloqueado pinch en `.tools__bar`, `.zoom` y `.panel`, pero no había nada que bloqueara el doble-tap-zoom de iOS, que es un gesto separado del pinch. `touch-action: pan-y` en `.panel` debería bloquearlo según spec, pero iOS Safari tiene bugs históricos donde `pan-y` deja escapar el doble-tap. El `<meta name="viewport" user-scalable=no maximum-scale=1>` también es ignorado por iOS por accesibilidad. La única forma confiable de bloquearlo a nivel global es `touch-action: manipulation` en el `<html>` — disabilita doble-tap-zoom site-wide pero permite `tap`/`click` y respeta los descendientes que tengan `touch-action` más restrictivo (e.g. `.panel` con `pan-y` sigue bloqueando pinch interno; `#viewport` con `none` sigue capturando todo manualmente).

Causa B: hipótesis principal — bug de compositing en iOS Safari. `.panel` tenía `position: fixed` + `backdrop-filter: blur` + `transform: translateX(-50%)` (para el centrado) **más** `transform: translateX(-50%) translateY(8px)` (para el estado oculto). Las dos transforms aplicadas a un elemento con backdrop-filter en iOS pueden disparar bugs de compositing donde el descendant subtree no pinta. El bar (mismo stack) renderizaba bien algunas veces y mal otras, lo que apuntaba a un bug de compositor, no de layout.

Fix:

```css
html { touch-action: manipulation; }   /* defensa global iOS doble-tap */

.crop-overlay { touch-action: none; }  /* belt-and-suspenders del bug #3 */

/* Centrado por margin, no por transform — frees `transform` para el slide */
.tools__bar, .panel {
  left: 0;
  right: 0;
  max-width: 320px;
  margin-inline: auto;
}

.is-menu-hidden .tools__bar { transform: translateY(-8px); }   /* sin compound */
.is-menu-hidden .panel      { transform: translateY(8px); }
```

Por qué `manipulation` en `<html>` y no en `<body>`: el efectivo `touch-action` se computa por intersección de ancestros. Poniéndolo en `<html>` cubre absolutamente todo el subtree, incluso elementos que se monten dinámicamente fuera de `<body>` (no es nuestro caso, pero es defensivo). `<body>` también funcionaría — la diferencia es semántica.

Por qué `manipulation` y no `pan-y` en html: `pan-y` permite scroll vertical (lo cual ya tenemos `overflow: hidden` en body, así que sería contradictorio); `manipulation` permite tap + pan + pinch pero bloquea doble-tap-zoom — es el balance correcto. Pinch se sigue bloqueando vía `gesturestart/change/end` document-level (§ 6) y vía `touch-action: none` en cada elemento del chrome (§ 7 bug #3).

**6. El panel no pintaba hasta abrir devtools (compositing bug)**

Síntoma: en mobile, al mostrar el menú, el bar de tabs aparecía arriba pero el `.panel` con los sliders/botones no renderizaba abajo — la zona quedaba completamente vacía. La hipótesis inicial de bug #5 (compound transforms con `backdrop-filter`) no era el culpable: aún con `margin-inline: auto` (un solo transform reservado para el slide), el panel seguía sin pintar.

Pista que lo destrabó: el panel **sí aparecía al togglear el inspect del devtools** (y al rotar el device, según testing posterior). Cualquier cosa que forzara un layout invalidation hacía que pintara. Eso es huella clásica de un bug de compositor — no un bug de layout.

Causa: `.panel` tenía `backdrop-filter: blur(16px) saturate(140%)` **+** `overflow-y: auto`. La `overflow-y: auto` convierte al elemento en un scroll container, lo que crea un stacking context y un compositor layer separado. Combinado con `backdrop-filter`, dispara un edge case donde el subtree del panel no se pinta hasta el siguiente layout invalidation. El `.tools__bar` (mismo `backdrop-filter`, sin `overflow`) renderiza bien — confirma que es la combinación, no el filter solo.

Fix: drop `backdrop-filter` del `.panel`. Background sólido de `rgba(13, 13, 13, 0.96)` (~94 % opaco) — visualmente casi indistinguible del blur cuando está sobre el borde inferior de la imagen, donde casi no hay contenido focal. El bar conserva su `backdrop-filter` (no tiene scroll, no dispara el bug).

Defensa adicional: `will-change: opacity, transform` en ambos (.tools__bar y .panel). Promueve a su propio GPU layer con backing store dedicado — el panel ya no depende de que el compositor "decida" pintarlo cuando hay layout activity.

```css
.panel {
  background: rgba(13, 13, 13, 0.96);   /* solid, no blur */
  will-change: opacity, transform;       /* GPU layer guarantee */
  /* SIN backdrop-filter / -webkit-backdrop-filter */
}
```

Por qué no probamos primero quitar `overflow-y: auto`: porque el panel de ajustes tiene 9 sliders + divider + 2 sliders de ruido — en landscape iPhone (414 × 736 → 50vh = 368px) puede desbordar. Sin scroll, los sliders de abajo quedan inaccesibles. El blur era nice-to-have; el scroll es funcionalidad core.

Side note: el `will-change` también suaviza la animación de fade en Android low-end, así que pago el cost de un GPU layer extra a cambio de un fix robusto + mejor perf de animación.

**7. El panel sigue sin pintar — `position: fixed` + `bottom: 0` mal posicionado en iOS Safari**

Síntoma: incluso después del fix #6, en iPhone real (Safari 17, iOS 17, abril 2026) el panel seguía sin aparecer al mostrar el menú. Quitar `is-menu-hidden` (con un botón de debug) hacía que el panel se volviera visible (`opacity: 1`, `visibility: visible`) pero **no estaba en el viewport** — estaba completamente arriba del top edge de la pantalla.

Diagnóstico (vía debug HUD que pinta `getComputedStyle` + `getBoundingClientRect` cada 200 ms en una capa `position: fixed; z-index: 9999` sobre la app):

```
panel:  rect x=37 y=-370 w=320 h=371
        position=fixed top=-370.5px bottom=0px
        transform=none
#tools: rect x=0 y=0 w=393 h=0
        display=block position=static
html:   client=393x659  scroll=393x659    ← html llena el viewport
body:   client=393x659  scroll=393x659    ← body también
vw=393  vh=659
```

La fórmula que usa el browser para `position: fixed` con `bottom: 0` y `height: 370.5px`:

```
top + height + bottom = containingBlockHeight
-370.5 + 370.5 + 0 = 0
```

El containing block tiene **height = 0**. Eso es exactamente lo que mide `#tools` (la `<section>` parent) — colapsada a 0 px porque todos sus hijos son `position: fixed` (out of flow). iOS Safari está usando `#tools` como containing block del `.panel` en vez del viewport, **violando el spec** (per CSS spec, el CB de un `position: fixed` es el initial containing block — el viewport — salvo que un ancestro tenga `transform`, `filter`, `will-change: transform/filter`, `contain`, `perspective` o `backdrop-filter`).

Ningún ancestro del panel tiene esas propiedades. `html`/`body` están en valores default (sólo `touch-action: manipulation`, `overflow: hidden`, `height: 100%` — nada que cree un nuevo CB). `#tools` es `position: static`. Bug de Safari iOS, fin.

Por qué `.tools__bar` (sibling, también `position: fixed`) NO sufre: usa `top: 56px` en lugar de `bottom: 0`. `top` se mide desde y=0 hacia abajo — y=0 del CB de 0-height y y=0 del viewport coinciden, así que la fórmula da el mismo resultado en ambos casos. **Sólo `bottom` (o `right`) expone el bug**, porque dependen de la dimensión del CB.

Fix: anclar el panel al borde inferior **vía `transform: translateY(...)`** desde `top: 0`, en vez de usar `bottom: 0`. Los porcentajes en `transform` se refieren al **tamaño propio del elemento**, no al containing block — sidestep total.

```css
.panel {
  position: fixed;
  top: 0;
  bottom: auto;
  transform: translateY(calc(100dvh - 100%));   /* 100dvh = visual viewport */
  /* ... */
}

.is-menu-hidden .panel {
  /* + 8 px de slide hacia abajo para la animación de hide */
  transform: translateY(calc(100dvh - 100% + 8px));
}
```

Por qué `100dvh` y no `100vh`: `100dvh` (dynamic viewport height) excluye la URL bar de Safari iOS — el panel queda flush sobre la URL bar visible. Con `100vh` (que sigue al layout viewport) el panel quedaría parcialmente atrás de la URL bar cuando ésta está visible. `100dvh` se soporta desde Safari 15.4 (marzo 2022), seguro para nuestros targets.

Por qué transforms explícitos en ambas reglas en vez de un CSS custom prop (`--panel-slide`): los custom props **no se interpolan en transitions** salvo que se registren con `@property`. Una regla `--panel-slide: 0px → 8px` haría snap, no fade. Repetir el `100dvh - 100%` en ambas reglas es feo pero necesario para que la `transition: transform 160ms` interpole bien.

Cómo lo descubrimos: agregamos un debug HUD activable con `?debug=1` que carga una imagen sintética y pinta computed styles + rects en vivo. Probamos dos fixes alternativos como botones (FIX-A: `html { height: 100% }` runtime; FIX-B: `transform translateY` desde top:0). FIX-A no hizo nada (html ya estaba bien), FIX-B funcionó al primer intento → bug confirmado, fix permanente aplicado.

Esa metodología (HUD live + botones de fix) ahorró horas de iteración a ciegas. Si volvés a debuggear bugs de iOS Safari mobile, agregalo de nuevo — el código está en el git history, filename pattern `?debug=1`.

**8. Touch area de los sliders muy chica**

Síntoma (no es bug, es UX miss): los sliders desktop usan track de 2 px y thumb de 10×10 px — perfecto para mouse, demasiado preciso para dedo. En mobile: difícil agarrar el thumb sin quedar pegado al borde, y al tirar del track entre dos thumbs muchas veces el tap se va a la fila de arriba/abajo en vez del slider.

Fix (mobile only, desktop sin cambios):

```css
@media (hover: none) {
  .panel input[type='range']                          { height: 6px; }
  .panel input[type='range']::-webkit-slider-thumb    { width: 22px; height: 22px; }
  .panel input[type='range']::-moz-range-thumb        { width: 22px; height: 22px; }
  .panel .sl                                          { padding-block: 6px; }
}
```

- Track de 2 → 6 px: el track ahora es tappable también, no sólo el thumb. Visualmente sigue siendo una línea fina.
- Thumb de 10 → 22 px: ~2× el área. Apple HIG pide 44 × 44 px como min, pero combinado con los 6 px del track + el padding del row, el área efectiva en el eje principal supera los 28 px — suficiente para tap sin frustration. No subimos a 44 porque visualmente rompe la estética minimalista del editor.
- Padding vertical de los rows: +6 px. Garantiza que un tap "casi en el thumb" pero ligeramente arriba/abajo siga llegando al slider correcto, no al de la fila vecina ni al gap.

Desktop sigue intocado — pointer fino = targets chicos están bien.

**9. Curves panel scroll + URL bar overlap**

Dos issues reportados juntos después del fix #7:

- **Curves con scroll vertical:** el canvas de curves es `aspect-ratio: 1/1` con `width: 100%` dentro de un panel de máx 320 px → ≈ 290 × 290 px. Sumado a las tabs de canal (≈ 30 px) y el hint (≈ 16 px) más gaps y padding ≈ 360 px. Con el cap global de `max-height: 50dvh` (≈ 330 px en iPhone 13 portrait), el canvas se clipea y el panel scrollea. Mala UX: el canvas ES la superficie de interacción — arrastrar un punto dentro de un scroll container pelea con el `touch-action`.
- **URL bar de Safari tapando el último slider:** el panel anclado a `100dvh - 100%` queda flush contra el bottom del viewport dinámico. En teoría correcto, pero durante la transición de entrada/salida de la URL bar de Safari iOS hay un frame donde el bar se monta sobre el panel. Aun cuando el bar está totalmente colapsado, el panel "besa" la chrome — no respira.

Fix:

```css
@media (hover: none) {
  .panel {
    /* +12 px de aire entre el panel y el bottom del dvh */
    transform: translateY(calc(100dvh - 100% - 12px));
    /* y el cap baja en sintonía para no crecer dentro del aire */
    max-height: calc(50dvh - 12px);
  }
  .is-menu-hidden .panel {
    /* base + 8 px de slide DOWN para hide → -12 + 8 = -4 */
    transform: translateY(calc(100dvh - 100% - 4px));
  }
  /* excepción: curves crece hasta 85 dvh para que el canvas entre sin scroll */
  .panel[data-panel='curves'] {
    max-height: calc(85dvh - 12px);
  }
}
```

Por qué cada cosa:

- `- 12px` en el transform: clearance contra la URL bar. 100dvh es teóricamente correcto pero Safari tiene una ventana de transición donde el bar se monta encima; 12 px elimina ese overlap y le da feel "asentado" al panel cuando el bar está colapsado.
- `max-height: calc(50dvh - 12px)`: si dejábamos `50dvh` solo, un panel alto crecería hasta tocar el bottom del dvh — anulando el clearance del transform. La resta los mantiene en sintonía.
- Excepción para curves con `85dvh`: alcanza para los ≈ 360 px de contenido en cualquier iPhone portrait, dejando aún espacio arriba para la zoom bar y abajo para la URL bar. No hacemos esto en adjust porque 9 sliders SÍ son un caso legítimo de scroll (lista de inputs independientes ≠ canvas draggable).
- `- 4px` en hide: aritmética sobre el nuevo offset (`-12 + 8 = -4`). Repetimos el cálculo en lugar de usar una CSS custom prop porque las custom props bare no animan en `transition` salvo que estén registradas con `@property` — y registrarlas para una sola animación no vale la pena.

Por qué no `100svh` (small viewport, asume URL bar visible) en lugar de `100dvh - 12px`: `svh` es estático — no crece cuando el bar se colapsa, así que el panel siempre quedaría 80-90 px arriba del bottom real cuando el usuario hace scroll y el bar desaparece. Feel raro: hueco grande sin contenido. `dvh` se ajusta dinámicamente; los 12 px de margen son constantes y absorben sólo la transición.

Por qué no reducir el canvas de curves en lugar de agrandar el panel: el canvas es la herramienta principal de esa pestaña — más chico = menos precisión para arrastrar puntos. Mejor agrandar el contenedor (es la única excepción y queda confinada al `data-panel='curves'`).

**10. Curve points "se sueltan" al moverlos un poco en mobile**

Síntoma: el usuario toca un punto de la curva, lo arrastra unos pocos px, y el punto deja de seguir el dedo aunque el dedo siga presionado. UX no-iOS: en iOS estándar (Photos, Mail draft) cuando agarrás algo, queda agarrado hasta que levantás el dedo.

Dos causas combinadas:

1. **`touch-action` heredado de la panel.** `.panel { touch-action: pan-y }` (mobile) permite que el panel scrollee verticalmente con un swipe del dedo. Como el `#curve` no tenía `touch-action` propio, heredaba ese comportamiento. Resultado: en cuanto el dedo se movía verticalmente unos px, el gesture recognizer de iOS Safari decidía "este es un scroll del panel padre" y emitía `pointercancel` al canvas → la captura del punto se rompía silenciosamente. El `setPointerCapture` no protege contra esto: una vez que iOS reclasifica el gesto, el capture se libera. JS no recibía más `pointermove` y veía un `pointercancel` que no estaba escuchando.
2. **`hitRadius` definido en unidades de curva (0–255), no display px.** 8 unidades en un canvas de ≈ 290 display px = ≈ 9 px de área tocable. Bien para mouse, ridículo para dedo (Apple HIG ≈ 44 px ideal).

Fix:

```css
#curve {
  /* el canvas reclama TODOS los gestos en su área */
  touch-action: none;
}
```

```ts
const isCoarse = matchMedia('(hover: none) and (pointer: coarse)').matches;
const hitRadiusPx = isCoarse ? 22 : 10;  // display px, no curve units

function findHit(e, pts) {
  const r = canvas.getBoundingClientRect();
  const sx = r.width / 255, sy = r.height / 255;
  const px = e.clientX - r.left, py = e.clientY - r.top;
  const t2 = hitRadiusPx * hitRadiusPx;
  for (let i = pts.length - 1; i >= 0; i--) {
    const dx = pts[i].x * sx - px;
    const dy = (255 - pts[i].y) * sy - py;
    if (dx * dx + dy * dy <= t2) return i;
  }
  return -1;
}

canvas.addEventListener('pointercancel', endDrag);  // defensa adicional
```

Por qué cada decisión:

- **`touch-action: none` en `#curve` (no `pan-y` heredado):** el canvas es interaction-only, no tiene contenido scrollable propio. Bloquear pan/zoom acá no le quita nada al usuario y le da a JS control total del gesto. Esto es lo que produce el "stuck to my finger" feel — iOS literalmente no puede robar el pointer mid-drag.
- **Hit radius en display px, no curve units:** la unidad de curva varía con el ancho display del canvas (en mobile ≈ 1.14 px/unit, en desktop podría ser distinto si la panel tiene otro ancho). Medir en display px hace que la sensación táctil sea consistente independiente del viewport. Iteración last-to-first del array de puntos: si dos puntos quedan apilados, gana el que se dibujó arriba (más reciente) — coherente con el orden visual.
- **22 px en coarse, 10 px en fine:** 22 px ≈ medio camino entre el cuadrado visible del punto (6 px) y el ideal HIG (44 px). Suficientemente grande para agarrar sin mirar fino, suficientemente chico para que dos puntos cercanos en X se puedan separar (los puntos están constrainted a ≥ 1 unit de separación en X = ~1.1 display px, y en la práctica el usuario los pone más lejos). En desktop con mouse, 10 px = ~9 unit-radius, ligeramente más generoso que el viejo 8 — feel idéntico.
- **`pointercancel` listener:** belt-and-suspenders. Con `touch-action: none` no debería disparar por gesture-stealing, pero iOS lo emite también en otros escenarios (multi-touch escalation, system gesture, llamada entrante). No manejarlo dejaba el `dragging` flag colgado: el siguiente `pointerdown` arrastraba el punto viejo en vez de seleccionar uno nuevo.
- **`hasPointerCapture?.` antes de `releasePointerCapture`:** evita warnings/throws si la captura ya fue liberada por el sistema (ej. justo después de `pointercancel`).

Por qué no `Math.abs(dx) < r && Math.abs(dy) < r` (cuadrado) como antes: visualmente el área tocable es un cuadrado, pero perceptualmente el dedo agarra "lo que está cerca", no "lo que cae en mi rectángulo". Distancia euclidiana (círculo) se siente más predecible cuando hay puntos diagonales.

## Roadmap restante

- **F. Bottom sheet con snap points** — el `.panel` actual es estático con `max-height: 50vh`. F sería convertirlo en un drawer drag-to-snap (collapsed / mid / full). Cambio mayor — requiere agregar pointer handlers al `.panel` que coexistan con pan/pinch en el canvas y el scroll vertical interno del propio panel. Considerar sólo si el feedback pide más control.
- **G. Strip horizontal de sliders** — en pestaña ajustes mobile, reemplazar 9 sliders verticales por strip de íconos + un slider grande del ajuste activo. Estilo iPhone Photos. Rediseño del panel adjust, ortogonal a Phase 3.
- **Tap-to-toggle también en desktop via keyboard shortcut** — agregar `f` o spacebar al keydown handler global llamando `setToolsHidden(!isMenuHidden())`. Trivial — ESC ya hace lo mismo, sería un atajo alternativo.
- **Pinch zoom desktop via wheel** — ya está (Ctrl/Cmd/Shift + wheel).

Si volvés a tocar este área, leé esto antes de mover algo — la coexistencia entre pinch / pan / tap / drag-to-hide es delicada y los flags son fáciles de descoordinar.
