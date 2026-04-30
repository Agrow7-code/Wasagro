# Tareas de Implementación: Evolución SDR 2026

## Preparación de Base de Datos y Tipos
- [ ] 1. Crear migración SQL `2026..._add_sdr_source_context.sql` para añadir `source_context` (TEXT) a `sdr_prospectos`.
- [ ] 2. Actualizar la interfaz `SDRProspectoRow` y `SDRProspectoInsert` en `src/types/dominio/SDRTypes.ts` con el campo `source_context`.
- [ ] 3. Añadir `source_context` a `NormalizedMessage` (si aplica) o directamente en el webhook/pipeline.

## Razonamiento Entrelazado y Rule API
- [ ] 4. Modificar `RespuestaSDRSchema` en `src/types/dominio/SDRTypes.ts`:
  - Añadir `reflection` y `plan` (strings).
  - Añadir `request_pricing` al enum de `action`.
- [ ] 5. Implementar la función `calcularPrecio` (determinista) en `src/agents/sdrAgent.ts`.
- [ ] 6. Actualizar `handleSDRSession` para interceptar la acción `request_pricing` y responder usando el guardarraíl de precio calculado.
- [ ] 7. Actualizar el prompt principal `prompts/SP-SDR-01-master.md` para instruir al LLM sobre el uso de los nuevos campos de razonamiento y la acción estricta de precios.

## CTWA (Click-To-WhatsApp) e Inicialización
- [ ] 8. En `procesarMensajeEntrante.ts` (o similar), extraer la data referral de WhatsApp y asignarla a `source_context`.
- [ ] 9. Pasar el `source_context` a la inicialización del prospecto en `handleSDRSession` y propagarlo a la `EntradaSDR` (ej. prompt) para un saludo personalizado.

## Smart Handoff (Enriquecimiento del Resumen)
- [ ] 10. Actualizar `DealBrief` en `src/types/dominio/SDRTypes.ts` y la función `buildFounderNotification` para asegurar que ningún campo clave (fincas, ICP, objeciones, problema) quede excluido en la transferencia al founder/CRM.

## Secuencias de Persecución (pgBoss)
- [ ] 11. Configurar en `handleSDRSession` que, al finalizar un turno, se encole un trabajo `sdr_chaser` con 20 horas de retraso (`startAfter`) pasando `prospecto.id` y `nuevoTurno`.
- [ ] 12. Crear `src/workers/sdrChaserWorker.ts` con el handler `sdrChaserHandler` que verifique `turns_total` frente a `expected_turn` antes de enviar el mensaje de seguimiento y guardar la interacción.

## Validaciones y Testing
- [ ] 13. Ajustar o crear tests en `tests/agents/sdrAgent.test.ts` para verificar la intercepción de `request_pricing`.
- [ ] 14. Escribir tests para el comportamiento de descarte del worker de persecución (`sdrChaserWorker`).