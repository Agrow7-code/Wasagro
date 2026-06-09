# 015 — UI de revisión de muestreos `requires_review` (scoped a finca)

**Fecha:** 2026-06-09
**Estado:** Aceptada

## Contexto

El sub-pipeline de Sigatoka (D29) deja muestreos en `status='requires_review'` cuando hay celdas ilegibles, confianza baja, discrepancias o cuando cae al fallback graceful. Hasta ahora **nadie consumía esos eventos**: quedaban en un pozo sin fondo. La imagen original se persiste en un bucket privado (`eventos-media`), pero sin URL firmada no se podía ver.

El *Pendiente* de D29 apuntaba esta UI a "(D28)". Es una referencia incorrecta: **D28 es el back-office de negocio del director** (clientes, P&L, embudo SDR, billing) — otro concern, otra audiencia. Revisar un muestreo de campo es tarea del **asesor de la finca**, no del director mirando finanzas. Además D28 no existe en código (`adminRouter`/`roleGuard`/`managementAlertsWorker` ausentes).

## Decisión

Capability propia, **scoped a finca** (no founder back-office), como tail humano de D29.

- **Backend** (`src/agents/finca/router.ts`, bajo `/api/finca/:finca_id`, `authMiddleware` + `requireFincaAccess`):
  - `GET …/sigatoka/revision` — cola de muestreos `requires_review` de la finca.
  - `GET …/sigatoka/revision/:evento_id` — detalle + URL firmada de la imagen + celdas ilegibles.
  - `PATCH …/sigatoka/revision/:evento_id` — corrige celdas (reusa `aplicarAclaraciones`, la MISMA lógica del follow-up por WhatsApp) y/o `marcar_revisado` = aprobación humana explícita (P7).
- **Storage:** `getSignedUrlEvento` genera URL firmada temporal del bucket privado (P5). Nunca lanza.
- **Queries:** `getEventosRevisionSigatoka`, `getEventoSigatokaById`.
- **Frontend:** `SigatokaRevisionView` en `/dashboard/sigatoka` (link en `NAV_ADMIN`). Primera vista del dashboard con datos REALES (el resto es mock): lista, foto original, inputs para completar ilegibles, acciones Guardar / Marcar revisado.

## Consecuencias

- **Gana:** cierra el loop `requires_review`; reusa la lógica de aclaración (un solo camino para WhatsApp y UI); aislamiento por finca (P5) y aprobación humana (P7) por diseño; la imagen queda auditable vía signed URL.
- **Limita:** es finca-scoped — no hay vista multi-finca para el asesor agronómico de una exportadora; el frontend no tiene test harness en el repo (verificado por `tsc` + `vite build`, no runtime).
- **No toca D28:** el back-office del director sigue sin construir y es independiente de esto.
- **Revisar:** si se necesita revisión multi-finca → extender o reubicar bajo el back-office; si el volumen de `requires_review` crece → paginación server-side.
