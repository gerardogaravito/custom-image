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

## Lo que NO está en Phase 1 (roadmap)

Discutido en chat y dejado para después:

- **E. Tools al fondo en mobile** — reposicionar `#tools` a `bottom: 0` con media query. Más cerca del pulgar. Cambio de layout puntual.
- **F. Bottom sheet con snap points** — restructurar el panel como un drawer estilo iOS Maps con 3 estados (collapsed / mid / full). Cambio mayor.
- **G. Strip horizontal de sliders** — en la pestaña ajustes, en mobile, replazar los 9 sliders verticales por un strip horizontal de íconos + un slider grande para el ajuste activo. Estilo iPhone Photos. Rediseño del panel.
- **Tap-to-immerse en desktop via keyboard shortcut** — agregar `f` o spacebar al keydown handler global llamando `toggleImmersed()`.
- **Pinch zoom desktop via wheel** — ya está (Ctrl+wheel). No requiere cambios.

Si volvés a tocar este área, leé esto antes de mover algo — la coexistencia entre pinch / pan / tap es delicada y los flags son fáciles de descoordinar.
