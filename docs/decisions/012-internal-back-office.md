# 012 — Back-office interno para gestión de Wasagro

**Fecha:** 2026-06-06
**Estado:** Aceptada
**Decisiones relacionadas:** D28 (CLAUDE.md), D26 (billing), D27 (costos)

## Contexto

Los founders de Wasagro no tienen visibilidad de: qué clientes están activos vs. churn, cuánto cuesta servir cada org vs. lo que pagan, estado del pipeline SDR, alertas de gestión. El dashboard existente es para clientes (gerente, exportadora) con mock data. Necesitan un panel INTERNO exclusivo para los dueños.

## Decisión

### Arquitectura: ruta `/admin` dentro de la misma app React

No es una app separada — es una sección del dashboard existente con acceso restringido a `rol = 'director'`. Razón: compartir componentes (sidebar, auth), misma codebase, mismo deploy.

### Pantallas

1. **Clientes** — Tabla de todas las orgs: plan, estado, eventos/mes, usuarios activos, costo/mes (D27), revenue/mes (D26), margen, fecha onboarding, última actividad. Filtros por plan, estado, sector.

2. **Cliente detalle** — Clic en org → fincas, usuarios, eventos por tipo, costos WA+LLM desglosados, P&L Wasagro, health score compuesto, historial billing.

3. **SDR funnel** — Data real de `sdr_prospectos`: conversión por status, por narrativa A/B, costo por lead, tiempo promedio por fase.

4. **Alertas de gestión** — Generadas por job pg-boss diario:
   - "ORG003 lleva 14 días sin eventos"
   - "ORG001 costo > revenue"
   - "Prospecto score 85 sin follow-up"
   - "Trial vence en 3 días"

5. **Billing** — Suscripciones, trials por vencer, pagos fallidos, revenue mensual, MRR trend. Aprobar transferencias manuales.

### Acceso

- Solo `rol = 'director'`
- Backend: middleware `requireRole('director')`
- Frontend: verifica rol del JWT, redirige si no tiene acceso
- JWT ya incluye `rol` (D22)

### Dependencias

- D26 (billing data) — sin esto no hay revenue, MRR, ni estado de suscripción
- D27 (cost data) — sin esto no hay margen ni P&L
- Se puede implementar la UI con datos parciales (clientes + SDR funnel primero) y agregar costos/billing cuando D26 y D27 estén listos

## Consecuencias

**Gana:**
- Visibilidad completa del negocio para los founders
- Data para tomar decisiones de pricing, churn, SDR effectiveness
- Un solo lugar para ver todo el estado de Wasagro

**Pierde/Riesgos:**
- Acceso `director` es amplio — si se necesitan permisos más granulares (ej: analista ve costos pero no billing), se necesita RBAC más fino
- Alertas de gestión pueden ser ruidosas si no se calibran umbrales → iterar rápido
- Si se separa en app propia después, hay que migrar componentes

**Próximos pasos:**
- Implementar `requireRole` middleware
- Crear `/admin` routes en App.tsx
- Implementar ClientesView con data de `organizaciones` + `eventos_campo`
- Implementar SDRFunnelView con data de `sdr_prospectos`
- Agregar costos (D27) y billing (D26) cuando estén disponibles
