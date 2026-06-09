# 016 — Extracción de Sigatoka en tres pasadas paralelas

**Fecha:** 2026-06-09
**Estado:** Aceptada

## Contexto

El extractor `sp-03e` hacía UNA llamada de visión para toda la ficha (matriz 19×3 +
DATOS A-M + EF + 11/00 semanas + plagas foliares + erradicadas). En pruebas contra
una ficha real (vía `railway run npx tsx scripts/probar-extraccion-sigatoka.ts`) el
resultado fue **no-determinista**: corrida a corrida el modelo soltaba secciones
distintas (a veces alineaba fórmulas pero perdía plagas; otras al revés) y nunca
capturaba todo junto. Inaceptable para mostrarle a un cliente.

Causa: la ficha es demasiado densa; el modelo "enfoca" una zona y deja huecos en el resto.

## Decisión

Dividir la extracción en **tres pasadas en paralelo** (`Promise.all`), cada una con
un prompt acotado a una zona, y mergear en un único `SigatokaMuestreo`:

1. `sp-03e1` — IZQUIERDA: encabezado + matriz de puntos P1..P19 + bloque DATOS A..M.
2. `sp-03e2` — TABLAS: PLANTAS DE 11 SEMANAS + 00 SEMANAS.
3. `sp-03e3` — PLAGAS: tabla EF + plagas foliares (Ceramida/Sibine) + diferidos (P-EF-FINCA, erradicadas).

Reglas del merge (`WasagroAIAgent.extraerMuestreoSigatoka`):
- Cada pasada (`#extraerParteSigatoka`) devuelve su JSON o `null` si falló (no lanza).
- `confidenceScore` = mínimo de las pasadas; una que falló cuenta 0 → fuerza
  `requires_review` para que el asesor complete lo faltante en la UI (D30).
- Si el merge no valida contra Zod, `construirFallbackSigatoka` rescata lo que haya (P1/P4).

Complementario (mismo commit): **coerción string→number** en todo el schema
(`numNullable`/`aNumero`) — los modelos de visión devuelven números como texto;
antes eso tiraba la ficha al fallback. Y alineación explícita de las filas A..M en el prompt.

## Consecuencias

- **Gana:** captura confiable y consistente de la mitad izquierda (datos críticos de
  severidad: EE2/EE3, hojas funcionales, fórmulas) — verificado en 3 corridas seguidas
  con `camposDudosos: []`. 11-semanas, erradicadas y P-EF-FINCA consistentes.
- **Costo:** ~3 llamadas de visión por ficha (antes 1). Latencia se mantiene porque
  van en paralelo (~12s típico).
- **Pierde/limita:** si una pasada timeoutea, el router reintenta entre proveedores y
  la latencia puede dispararse (se observó un outlier de ~131s) — la pasada termina en
  `null` → `requires_review`. **Pendiente:** las plagas foliares se capturan como sección
  pero con valores en 0 (la sub-tabla multi-fila por sector aún confunde al modelo) →
  refinar `sp-03e3` o respaldar con la revisión D30.
- **Revisar:** cap de latencia total del router; segundo formato de ficha → generalizar prompts.
