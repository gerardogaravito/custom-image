# custom-image — persist (sesión entre recargas)

El usuario puede cerrar la pestaña, refrescar, o volver al sitio mañana — y todo el progreso (imagen cargada, ajustes, curvas, recorte aplicado) sigue ahí. Implementado con IndexedDB.

## Qué se persiste

`Session` (en `src/persist.ts`):

```ts
type Session = {
  schemaVersion: 1;
  sourceName: string;
  blob: Blob;                       // archivo original (post-HEIC)
  appliedCrop: CropBox | null;      // en coords del SOURCE ORIGINAL
  state: { adjust: Adjust; curves: Curves };
};
```

Lo crítico: **se persiste el blob original, no la `ImageData` derivada**. Razones:

- Una `ImageData` raw de 4096×3072 son ~50 MB. El JPG comprimido del iPhone son 3-5 MB. La diferencia es 10×.
- El blob ya viene del usuario, no hay re-encoding.
- Re-decodear en el reload es rápido (~100-300ms) gracias a `createImageBitmap` nativo.

Lo que **no se persiste** (decisión consciente):
- Undo / redo stack (overkill, los snapshots cuestan memoria).
- Tab activo (vuelve a `curvas` por default — minor).
- Zoom level (vuelve a `'fit'` — el más útil al re-abrir).
- In-progress crop UI (la box, aspect, orient mientras editás dentro de la pestaña recortar). Se resetea a defaults.
- `tools.hidden` (siempre arranca visible cuando hay imagen).

## El truco de `appliedCrop`

El crop es destructivo: `cropImageData` reemplaza `source` y `preview` con un slice. Si solo persistís el blob, perdés el recorte. Si persistís `source` y `preview` re-encoded como PNG, pagás cientos de ms de encoding por save.

Solución: persistir el blob original + las **coordenadas del crop acumulado en el sistema del source ORIGINAL** (`appliedCrop`). Al reload:

1. Decodear blob → `originalSource` + `originalPreview` (intactos).
2. Si `appliedCrop !== null`: aplicar `cropImageData(originalSource, appliedCrop)` para derivar `source`. Para `preview`, proyectar la box a sus coords y aplicar.

Cuando el usuario aplica un crop nuevo sobre uno ya recortado, `composeAppliedCrop(prev, next)` (en `crop.ts`, función pura) compone los offsets:

```ts
appliedCrop = composeAppliedCrop(appliedCrop, sourceBoxPx);
```

Donde `sourceBoxPx` es la box del nuevo crop **en coords del current source** (ya recortado por `prev`). El acumulado queda siempre en coords del original. Tests de regresión en `crop.test.ts > composeAppliedCrop`.

Cuando se hace "restaurar al original" (botón crop reset), `appliedCrop = null`. `source` y `preview` vuelven a apuntar a los originales.

## Cuándo se guarda

`scheduleSave()` (debounced 400ms) se llama en estos puntos:

- **Después de cargar imagen** (`handleFile` post-`loadImage`): primer save de la sesión.
- **Fin de cada burst de interacción** (slider/curva): se hace en el callback del `interactionEndTimer` (mismo timer que ya existe para el preview interactivo).
- **Reset de ajustes** (botón `#reset`).
- **Aplicar crop** (`#crop-apply`).
- **Restaurar crop** (`#crop-reset`).
- **Undo / redo** (vía `applySnapshot`).

El debounce de 400ms evita escribir durante un drag continuo. Si el usuario cierra dentro de los 400ms post-acción, ese último cambio se pierde — trade-off aceptable para no thrashear IndexedDB.

## Cuándo se carga

Al final de `main.ts` un IIFE async corre `loadSession()`. Si hay sesión válida y `schemaVersion === 1`, llama `restoreSession(saved)`. Si falla cualquier paso (blob corrupto, dimensiones inválidas, etc.), se llama `clearSession()` y la app arranca limpia.

`restoreSession` reusa la lógica de `loadImage` (decode bitmap → fit canvas → getImageData) pero se queda inline en lugar de delegar — no queremos disparar el toast de "imagen cargada" ni resetear el undo stack como si fuera una imagen nueva. Muestra un toast `"sesión restaurada — {nombre}"` discreto (2.5s).

## Quota

IndexedDB en navegadores modernos otorga al menos 50 MB sin pedir permiso (Chrome/Safari/Firefox). Una foto típica del iPhone (3-8 MB) entra holgada. Si hay error de quota, `saveSession` lo loggea y sigue (best-effort, no bloquea la app).

## Privacidad

La data vive en el storage del navegador del usuario, **nunca sale del dispositivo**. No hay servidor que reciba los blobs. Para limpiar manualmente: el usuario puede borrar storage del sitio desde DevTools/Settings, o subir otra imagen (la sesión vieja se sobreescribe).

A futuro podríamos agregar un botón "limpiar sesión" en el dropdown de reset por UX, pero hoy no está.

## Edge cases manejados

- **Schema mismatch**: si `schemaVersion !== 1`, `loadSession` devuelve null. Cuando subamos a v2 se descartan las sesiones viejas.
- **Blob corrupto / no decodificable**: `restoreSession` throws → catch en el IIFE → `clearSession`. App arranca vacía.
- **IndexedDB no disponible** (private browsing en algunos browsers): `loadSession`/`saveSession` catchean y son no-op.
- **Re-decode del blob es async**: el drop zone se muestra brevemente (~100-300ms) antes de que la sesión restaure. Aceptable. Si llegara a molestar, agregar un flag rápido en `localStorage` para esconder el drop zone optimistically.

## Bug histórico — `state.curves` desalineado

Originalmente `state.curves` se inicializaba con su propio `defaultCurves()`, distinto del `curves.state` interno del widget. La intención era que se alinearan en la primera interacción del usuario (callback `state.curves = curves.state`). Funcionaba en la mayoría de los casos pero dejaba un grey area: si por alguna razón el callback no llegaba a correr antes del primer save, persistíamos el `defaultCurves()` original y los puntos editados no llegaban al storage.

**Fix**: alinear las referencias DESDE el init. Ahora `state` se declara DESPUÉS de `mountCurves` y reusa la referencia:

```ts
const curves = mountCurves(curveCanvas, () => flagInteraction());
const state: State = { adjust: defaultAdjust(), curves: curves.state };
```

Resultado: `state.curves === curves.state` siempre. El callback de `mountCurves` ya no necesita reasignar; los `state.curves = curves.state` dispersos en `applySnapshot`, `reset` y `restoreSession` también se eliminaron — eran no-ops después del cambio.

## Out of scope

- Múltiples sesiones (slot-based). Hoy solo hay una sesión activa, identificada por `KEY = 'current'`.
- Auto-save al servidor (sería todo el opuesto del modelo "100% local").
- Persistir el undo stack (ImageData refs en RAM × 20 snapshots = mucho).
- Versionado del store IndexedDB (`DB_VERSION = 1`). Si hay que migrar, bumpear versión + escribir `onupgradeneeded` migración.
