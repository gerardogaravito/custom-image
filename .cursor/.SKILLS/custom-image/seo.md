# custom-image — SEO, social previews, analytics

Cómo está configurado el sitio para que lo encuentren buscadores y agentes de IA, cómo se ve cuando lo comparten en redes, y cómo se miden visitas.

## Estrategia de posicionamiento

**Angle principal**: alternativa gratis a Adobe Lightroom para desktop. El insight: Lightroom mobile es gratis, pero Lightroom desktop solo viene con el Photography Plan de Adobe (USD 9.99/mes mínimo). No existe una versión gratis para computadora con los mismos ajustes básicos — ese es el hueco que llenamos.

Todo el copy de SEO empuja este mensaje:

- **`<title>`**: `imagen.garavito.dev` (literal, decisión del producto — brand-style, no descriptivo).
- **`<meta description>`**: empieza con "Alternativa gratis a Adobe Lightroom para desktop". Esto es lo que sale en los resultados de Google.
- **`<meta keywords>`**: términos en español e inglés — "alternativa Lightroom gratis", "Lightroom desktop gratis", "free Lightroom alternative", "sin Adobe", "sin subscripción".
- **JSON-LD**: `description` y `featureList` enfatizan el paralelismo con features de Lightroom ("equivalente al panel Tone Curve", "los mismos parámetros básicos de Lightroom", "sin Adobe Creative Cloud").
- **`llms.txt`**: tiene una sección **Comparación rápida con Lightroom** (tabla) y la historia del origen. Esto es lo que agentes de IA (ChatGPT, Claude, Perplexity) leen cuando el usuario pregunta cosas como "qué editor uso si no quiero pagar Lightroom".

### Por qué este angle específico

Las palabras clave genéricas ("editor de fotos gratis") tienen competencia brutal (Canva, Photopea, Pixlr, Fotor, etc.). Apuntar a **intents más específicos** — la gente que busca explícitamente una alternativa a Lightroom — da mejor ROI porque hay menos resultados y más intent matching. La tabla comparativa en `llms.txt` + el bloque "Por qué existe" es exactamente lo que LLMs citan cuando responden "dame alternativas gratis a Lightroom".

Si en el futuro agregás una feature que Lightroom tampoco tiene, seguir el mismo patrón: mencionar en `description` + `featureList` + `llms.txt`.

## Contenido semántico para crawlers sin JS

El sitio es una SPA vanilla TS. Sin JavaScript, el `<body>` prácticamente no tiene contenido útil — solo el shell del canvas. Los crawlers antiguos (y algunos bots de IA) no ejecutan JS, así que verían una página vacía.

Solución: `<h1 class="sr-only">` + `<p class="sr-only">` con contenido descriptivo al principio del body, más un bloque `<noscript>` con fallback. La clase `.sr-only` es el patrón a11y estándar (posición absoluta + clip de 1×1px) — invisible visualmente pero **presente en el DOM** para screen readers y crawlers. **No usar `display: none`** porque eso esconde el contenido también de los bots.

Contenido actual del h1 sr-only: "imagen.garavito.dev — alternativa gratis a Adobe Lightroom para desktop". Todos los keywords importantes.

## Dominio

## Dominio

- **Producción**: `https://imagen.garavito.dev` (CNAME en GoDaddy → `*.vercel-dns-017.com`).
- **Vercel internal**: `custom-image.vercel.app` (sigue funcionando como fallback).

Todas las URLs absolutas en el `<head>` (canonical, OG, sitemap, JSON-LD) usan `https://imagen.garavito.dev/`.

## `<head>` — qué hay y por qué

Estructurado en `index.html`:

| Bloque | Para qué |
|---|---|
| `<title>` + `<meta name="description">` | Lo que ves en Google y en pestañas del navegador. |
| `<meta name="keywords">` | Casi obsoleto (Google lo ignora) pero algunos bots lo siguen leyendo. |
| `<link rel="canonical">` | Le dice a buscadores cuál es la URL "oficial" para evitar contenido duplicado entre `imagen.garavito.dev` y `custom-image.vercel.app`. |
| `<meta name="robots" content="index, follow">` | Permite indexar todo. |
| `<link rel="icon">` + `<link rel="apple-touch-icon">` | Favicon (cordero) en pestañas y al guardar como app. |
| `<meta property="og:*">` | **Open Graph** — usado por Facebook, LinkedIn, WhatsApp, Slack, Discord para mostrar preview cuando alguien comparte el link. |
| `<meta name="twitter:*">` | Twitter/X usa su propio formato; `summary_large_image` muestra la imagen grande. |
| `<script type="application/ld+json">` | **Structured data** (schema.org `WebApplication`). Esto es lo que más leen Google + agentes de IA. |

### Open Graph image

`public/og.png` — 1200×630 (1.91:1), tamaño recomendado por Facebook/LinkedIn. Está generado con `sips`:

```bash
sips -Z 600 source.png --out resized.png            # resize cordero a 600px
sips --padColor 0a0a0a -p 630 1200 resized.png \
     --out public/og.png                             # padding negro a 1200x630
```

Si cambiás el cordero o querés otra OG, regenerá con esos dos comandos. **Vercel cachea aggressively**: después de un deploy nuevo, ejecutar el [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) con la URL para forzar que FB recachee.

### JSON-LD (`WebApplication`)

Schema oficial de schema.org. Le da a Google y a los crawlers de IA un manifiesto estructurado de qué es la app:

- `name`, `url`, `description`, `applicationCategory: "MultimediaApplication"`.
- `applicationSubCategory: "Photo Editor"`.
- `isAccessibleForFree: true` + `offers.price: "0"`.
- `featureList` — array de capacidades clave (curvas, ajustes, recorte, HEIC, etc.). Esto es lo que los agentes de IA usan para responder "buscame un editor de fotos gratis online" o similares.
- `creator` — link al sitio personal.

Si agregás features grandes, **actualizá el `featureList`**.

## Crawlers y agentes de IA

`public/robots.txt` permite a todos, con bots de IA listados explícitamente (algunos respetan únicamente reglas con su user-agent específico):

- `GPTBot` (OpenAI / ChatGPT)
- `ClaudeBot` y `anthropic-ai` (Anthropic / Claude)
- `PerplexityBot` (Perplexity)
- `Google-Extended` (Gemini / Bard)
- `CCBot` (Common Crawl — alimenta muchos modelos open)

`public/sitemap.xml` lista la URL única (es SPA de una sola página). Si en el futuro hay rutas, agregar más `<url>`.

`public/llms.txt` es una convención emergente (propuesta de Anthropic, adoptada por muchos sitios) para darle a los LLMs un resumen markdown del sitio. Algunas IA leen este archivo cuando un usuario les comparte la URL. Útil porque las SPAs vacías son difíciles de entender por crawlers que no ejecutan JS.

## Vercel Analytics

Dos paquetes, instalados como deps regulares:

- `@vercel/analytics` — eventos de visita (page views, geo, devices). Visible en `vercel.com → custom-image → Analytics`.
- `@vercel/speed-insights` — métricas Core Web Vitals (LCP, FID, CLS, INP) reales de usuarios. Visible en `... → Speed Insights`.

Activación en `src/main.ts`:

```ts
import { inject as injectAnalytics } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

injectAnalytics();
injectSpeedInsights();
```

Ambas funciones **auto-detectan el entorno**: en `vercel dev` o `npm run dev` no envían beacons (no-op). Solo se activan en deployments de producción de Vercel.

**Activar en el dashboard**: la primera vez que se despliegue con estos paquetes, Vercel detecta los beacons y aparecen las pestañas Analytics + Speed Insights (puede pedir activar el plan gratis con un click).

### Costo de bundle

- `@vercel/analytics` ≈ 1.5 kB gzipped
- `@vercel/speed-insights` ≈ 1.8 kB gzipped

Total ~3 kB. Aceptable.

## Workflow para nuevos features que afecten SEO

Si agregás algo importante (ej. una nueva capability del editor) y querés que se refleje:

1. Actualizar `featureList` en el JSON-LD del `<head>`.
2. Actualizar `public/llms.txt` (sección "Para qué usarlo").
3. Si es una característica visible, considerar mencionarla en `<meta name="description">`.
4. Si cambia la OG image, regenerar `public/og.png` y purgar el cache de FB con su debugger.

## Out of scope

- **Multi-idioma** — todo está en español (ES). Si se quisiera inglés, usar `<link rel="alternate" hreflang="...">` y replicar tags.
- **PWA / `manifest.json`** — el sitio no se instala como app, solo es responsive. Si se quiere "Add to Home Screen", agregar manifest y service worker.
- **Cookie banner / GDPR** — Vercel Analytics no usa cookies, así que no necesitamos consent. Si se agrega Google Analytics u otro tracker que sí use cookies, hay que poner banner.
- **Open Graph dinámico** (Vercel OG) — overkill para una sola URL. Si en el futuro hubiera presets compartibles con URLs únicas, ahí sí tiene sentido.
