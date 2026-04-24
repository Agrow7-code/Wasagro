# 001 — Hono (TypeScript) reemplaza n8n como orquestador

**Fecha:** 2026-04-21
**Estado:** Aceptada

## Contexto

Wasagro necesita un orquestador que reciba webhooks de WhatsApp, ejecute el pipeline STT→LLM→Supabase, maneje estado conversacional (P2: máx 2 preguntas), calcule confidence scores, y trace cada llamada en LangFuse (P4).

n8n fue evaluado como opción inicial por su ventaja visual y zero-deploy. Se construyeron 4 flujos (recibir mensaje, procesar reporte, onboarding, reporte semanal).

## Problema con n8n

La lógica de negocio de Wasagro no es orquestable limpiamente en nodos:

- **Estado conversacional**: saber cuántas preguntas se hicieron en esta sesión requiere leer Supabase + evaluar + decidir. En n8n es un Function node con TypeScript + nodo HTTP. Ya es código, pero sin tests.
- **Confidence scoring y routing**: árbol de decisión que crece. Se convierte en Switch nodes anidados, ilegibles en 2 semanas.
- **LangFuse**: integración correcta requiere envolver cada llamada con trace→generation→score. En n8n son 4-5 nodos HTTP por llamada. En código es un wrapper de 10 líneas.
- **Mantenibilidad**: los flujos n8n en git son JSON de 800+ líneas. El diff es ilegible.
- **Testing**: imposible hacer unit tests de lógica dentro de nodos Function.

## Decisión

Reemplazar n8n con un servicio **Hono (TypeScript)** deployado en Railway.

**Stack**: Hono + TypeScript + Zod + Vitest + Railway

**Arquitectura**:
```
Meta Cloud API
      ↓ POST /webhook/whatsapp
Hono service (Railway)
      ├── src/webhook/    — recibe, valida (Zod), despacha
      ├── src/pipeline/   — STT → LLM → extracción
      ├── src/agents/     — estado conversacional, scoring, routing
      ├── src/integrations/ — OpenAI, Supabase, Meta API, LangFuse
      └── src/types/      — Zod schemas + TS types
```

## Consecuencias

**Ganancias:**
- Lógica de negocio testeable con Vitest
- Git diff legible
- LangFuse SDK directo (3 líneas vs 5 nodos)
- Estado conversacional como query directa a Supabase
- $5/mes Railway vs $20/mes n8n → ahorro neto $15/mes

**Costos:**
- Requiere deploy manual (Railway desde GitHub, automático en merge a main)
- Sin UI visual para leer flujos — compensado con tests y nombres descriptivos
- Bus factor aumenta si el único desarrollador no conoce TypeScript — bajo riesgo en H0

**Flujos n8n eliminados**: La lógica equivalente está en `src/pipeline/` y `src/agents/`.

## Condición de revisión

Si el volumen supera 500 eventos/día y se necesitan colas distribuidas: evaluar Inngest (añade queue + retry declarativo encima del servicio Hono, sin reemplazarlo).
