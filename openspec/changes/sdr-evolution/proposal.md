# Propuesta Técnica: Evolución SDR 2026

## Intención Estratégica
Transformar el SDR de Wasagro en un agente autónomo de ventas, utilizando contexto inicial, razonamiento entrelazado (Plan-Act-Reflect), guardarraíles de precios deterministas, handoffs más fluidos y secuencias de reenganche proactivas.

## Alcance (In/Out)
**In-scope:**
- Webhook/Pipeline: Inyectar contexto CTWA (Click-to-WhatsApp) proveniente de atributos de referral o del primer mensaje en la inicialización de `SDRProspecto`.
- Prompt & LLM Schema: Cambiar la respuesta de `RespuestaSDRSchema` para emitir internamente campos de `plan`, `reflection` y `action` separados, e incluir acciones como `request_pricing` que no dependan del LLM para el cálculo del monto.
- SDR Agent: Manejar la acción determinista `request_pricing`.
- CRM / Handoff: Ajustar el `DealBrief` para enviar un resumen consolidado con todo el contexto cuando se pasa a aprobación o venta final.
- Workers (pgBoss): Crear dos colas: `sdr_chaser_sequence_1` (20 hrs) y `sdr_chaser_sequence_2` (reenganche post 24hrs usando utilidades).

**Out-of-scope:**
- Modelos LLM distintos a los ya configurados.
- Cambios mayores en la capa de persistencia (Supabase) salvo migrar algunos tipos para las nuevas acciones.
- Plantillas de WhatsApp nativas por ahora (las secuencias se simularán con `sender.enviarTexto`).

## Enfoque de Implementación
1. **Zod Schemas y Prompt**: Refactorizar `RespuestaSDRSchema` y el Prompt Principal (probablemente en `prompts/SP-SDR-01-master.md`). 
2. **Manejo CTWA**: Extender `NormalizedMessage` o `SDRProspectoInsert` para incluir `source_context` que alimentará el contexto inicial.
3. **Guardarraíl Determinista**: Modificar `handleSDRSession` para que cuando `action === 'request_pricing'`, se intercepte, se calcule la cotización según `segmento_icp` y tamaño de finca, y se devuelva un mensaje ensamblado o se reinyecte al LLM (recomendado: respuesta estricta).
4. **Smart Handoff**: `buildFounderNotification` ya genera buen contenido. Ampliaremos `deal_brief` y `SDRProspectoRow` para marcar de forma inmutable el contexto.
5. **Chaser Sequences**: Integrar `pgBoss.send('sdr_chaser', { prospecto_id, turn }, { delay: '20h' })` al finalizar cada turno de `handleSDRSession`. Si hay un nuevo mensaje del prospecto antes, cancelar o invalidar el job.

## Riesgos y Mitigación
- **Riesgo**: El LLM intenta dar precios a pesar del guardarraíl.
  **Mitigación**: Instancias de prueba estrictas, añadiendo System Prompt reforzado: "NUNCA expongas un precio monetario. Usa SIEMPRE la acción `request_pricing`".
- **Riesgo**: Race conditions en las Chaser Sequences.
  **Mitigación**: Validar el campo `updated_at` (o `turns_total`) en el worker de `pgBoss`; si el turno cambió desde que se encoló el job, el job aborta.