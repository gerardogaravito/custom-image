# custom-image — undo / redo

Sistema de deshacer y rehacer global. Permite revertir cualquier acción del usuario (cambios de slider, edición de curvas, doble-click reset de un valor, reset general, aplicar crop, restaurar crop) — y volver a aplicarla con redo.

## API

`src/undo.ts` exporta dos clases puras (sin DOM, totalmente testeables en `src/undo.test.ts`):

- **`UndoStack<T>`** — LIFO con `push`/`pop`/`size`/`isEmpty`/`clear` y un `limit` configurable (default 20). Cuando se llena, descarta el más viejo.
- **`History<T>`** — coordinador de dos `UndoStack`s (past + future). Implementa el pattern canónico:
  - `push(snap)` → guarda en past, **limpia future** (acción nueva invalida el redo).
  - `undo(current)` → mueve un snap de past → future (recibe el current para stash) y devuelve el popped.
  - `redo(current)` → mueve un snap de future → past y devuelve el popped.
  - `canUndo()` / `canRedo()` para gating.

`src/main.ts` la consume así:

```ts
const history = new History<Snapshot>(20);

function pushUndo() { history.push(makeSnapshot()); }
function undo()    { applySnapshot(history.undo(makeSnapshot())!); }
function redo()    { applySnapshot(history.redo(makeSnapshot())!); }
```

`makeSnapshot()` y `applySnapshot()` son los únicos puntos donde se sabe la forma del snapshot — el resto del código solo lidia con la coordinación.

`Snapshot` captura el estado completo del editor en un momento dado:

```ts
type Snapshot = {
  adjust: Adjust;                            // copia superficial
  curves: Curves;                            // deep copy (Point[] por canal)
  source: ImageData;                         // ref shareada (no se muta)
  preview: ImageData;                        // ref shareada
  interactivePreview: ImageData | null;      // ref shareada
  // Crop state — sin esto, undo de "aplicar" restauraba source/preview pero
  // perdía la selección del usuario y el overlay desaparecía.
  cropBox: CropBox | null;
  cropAspectKey: string;
  cropOrient: 'portrait' | 'landscape';
};
```

**Por qué deep-copy de `curves` y `cropBox` pero no de `adjust`/`source`/`preview`**:

- `adjust` es un objeto plano de números — `{ ...state.adjust }` basta.
- `curves` tiene arrays anidados de objetos `Point` que el widget MUTA en su lugar. Sin deep copy, el snapshot apuntaría al mismo array y se "pisaría" cuando el usuario sigue editando.
- `cropBox` también se muta in-place (cada `pointermove` reasigna `cropBox.x/y/w/h`). Snapshot necesita `{ ...cropBox }`.
- `source` / `preview` son `ImageData`. El pipeline (`apply()`) **no muta** su input (verificado por test). El crop (`cropImageData()`) crea buffers nuevos. Nadie modifica los píxeles in-place, así que compartir referencias es seguro y barato (no copiar 8MB de píxeles por snapshot).

## Triggers

`pushUndo()` se llama antes de cada acción mutativa:

- **Inicio de cada "burst" de interacción** con sliders o curvas. Implementado dentro de `flagInteraction()`: si `isInteracting === false` (o sea, primer evento del burst), pushea un snapshot **antes** de aplicar el cambio. Durante el drag (continuous input) no pushea más. Después de `INTERACTION_RELEASE_MS` (150ms) sin más eventos, el burst termina y el siguiente input creará otro snapshot.
- **Doble click sobre el indicador de valor** (reset al default de un slider individual). Va por la misma vía: `setSliderValue` → `flagInteraction` → push.
- **Reset de ajustes** (botón `#reset` en el header de herramientas).
- **Aplicar crop** (botón `#crop-apply`). Implementado vía un listener adicional en `capture: true` que corre antes del listener inline que muta `source`/`preview`.
- **Restaurar crop al original** (botón `#crop-reset`).

### Por qué snapshot al INICIO del burst y no al final

Si snapshoteamos al final, el undo restauraría el estado *post*-cambio (no haría nada perceptible). Snapshoteando al inicio, el snapshot captura el estado *pre*-cambio, que es lo que el usuario espera ver al deshacer.

### Por qué solo una vez por burst

Un slider arrastrado dispara cientos de eventos `input`. Si cada uno pusheara, el stack se llenaría con snapshots casi-iguales y un undo restauraría a un punto microscópicamente anterior — inútil. Una sola entrada por gesto coincide con la mental model del usuario: "una arrastrada de slider = una acción undo-able".

### Bug histórico (corregido)

Originalmente solo Reset y Crop pusheaban snapshots; los cambios de slider y curva no. Esto generaba un comportamiento confuso:

1. Usuario hace cambio en slider → no snapshot.
2. Usuario hace reset → snapshot del estado post-slider.
3. Undo → restaura el estado post-slider. (El usuario lo percibe como "deshizo el reset, todo bien".)
4. Usuario hace otro cambio en slider → no snapshot.
5. Undo → "nada que deshacer". 

El fix fue añadir el push dentro de `flagInteraction()`. Test de regresión documentando el contrato del stack: `src/undo.test.ts > UndoStack — regression: repeated push/pop cycles`.

## Disparadores

**Undo:**
1. **Click en el botón "undo"** dentro de un toast. Los toasts de las acciones destructivas (reset general, aplicar crop, restaurar crop) incluyen una `action: { label: 'undo', onClick: undo }`.
2. **`Cmd/Ctrl + Z`** en cualquier momento (excepto si está vacío — muestra "nada que deshacer").

**Redo:**
1. **`Cmd/Ctrl + Shift + Z`** — pop del future stack y re-aplicar.

`Cmd+Z` y `Cmd+Shift+Z` se permiten incluso desde inputs porque los sliders no tienen su propio undo nativo, y los únicos text inputs son el file picker (donde igual no harían nada útil).

## Por qué el crop apply ahora se queda en crop mode

Antes del fix, `applyCrop` llamaba `exitCropMode()` y seteaba `cropBox = null`. El usuario quedaba en la pestaña recortar visualmente, pero sin overlay. Y al hacer undo, el snapshot solo restauraba `source`/`preview`, no `cropBox` — el overlay seguía desaparecido y no se podía modificar el recorte.

El fix tiene dos partes:

1. **`applyCrop` no sale del crop mode**. En su lugar, resetea `cropBox` a las nuevas full bounds (post-crop) y llama `syncOverlay()`. El usuario ve un overlay nuevo cubriendo toda la imagen recortada — puede iterar (re-cortar) o cambiar de tab para salir.
2. **El snapshot incluye `cropBox` + `cropAspectKey` + `cropOrient`**. `applySnapshot()` los restaura y refresca los botones activos del panel + sincroniza el overlay si `cropActive`.

Combinado: undo desde post-aplicar restaura source/preview viejos AND la selección del usuario AND el aspect activo. Test de regresión: `src/undo.test.ts > History > regression — crop scenario`.

## Toast con action

`src/toast.ts` extendido:

```ts
type ToastAction = { label: string; onClick: () => void };
type ToastOptions = { kind?, durationMs?, action? };

toast('ajustes restaurados', {
  kind: 'info',
  action: { label: 'undo', onClick: undo },
});
```

Se renderiza como `[mensaje] [botón "undo"]`. Click en el botón ejecuta la acción y cierra el toast (`stopPropagation` evita el doble dismiss). Click en el resto del toast cierra sin acción.

CSS: `.toast__action` se pinta con `color: var(--accent)` y subrayado para indicar que es interactivo.

## Reset del stack

`undoStack.length = 0` cuando se carga una imagen nueva. Razón: los snapshots viejos referenciaban buffers `source`/`preview` que ya no aplican a la nueva imagen — restaurarlos rompería el editor.

## Límite

`UNDO_LIMIT = 20` snapshots. Llega al límite → se descarta el más viejo (`shift()`). Cada snapshot pesa unos pocos kilobytes (los ImageData son referencias, no copias) — el límite es prudencia, no necesidad.

## Out of scope

- **Redo** — no implementado. Si lo querés, mantener un `redoStack` paralelo y mover snapshots entre stacks. Cualquier acción nueva (no-undo) limpia el redo.
- **Snapshots por slider** — hoy no se snapshotea cada cambio de slider. Si se quisiera, hay que debouncear (ej. snapshot al `pointerup` del slider, no en cada `input`).
- **Persistencia entre sesiones** — al recargar la página se pierde el stack. Si se necesitara, serializar a localStorage (cuidando que `ImageData` no es JSON-serializable — habría que convertir a base64 PNG).
