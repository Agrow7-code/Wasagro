# Propuesta Técnica: Re-Arquitectura del SDR a Modelo de Extracción Determinista

## Intención Estratégica
El modelo de LLM "conversacional con guardarraíles" ha demostrado ser ineficiente para el SDR comercial: es redundante, no cierra a tiempo y enoja a los clientes. Reemplazaremos este modelo por un enfoque de **Extracción de Entidades + Enrutamiento Determinista** (similar a cómo funciona la toma de datos de `WasagroAIAgent`).

## Arquitectura Propuesta

1. **Extracción (LLM como Parser, no como Orador)**:
   - Se elimina el System Prompt conversacional (`SP-SDR-01-master.md`).
   - Se crea un nuevo extractor `SP-SDR-02-extractor.md` cuya única función es leer el mensaje del usuario y el historial reciente, y devolver un JSON con los siguientes campos estrictos:
     ```typescript
     {
       es_spam: boolean,
       hectareas_detectadas: string | null,
       cultivo_detectado: string | null,
       pais_detectado: string | null,
       metodo_registro_detectado: string | null,
       pregunta_precio: boolean
     }
     ```

2. **Lógica Determinista (TypeScript como Orador)**:
   - En `sdrAgent.ts`, al recibir el mensaje, se actualizan los campos de la base de datos `sdr_prospectos` (`fincas_en_cartera`, `cultivo_principal`, `pais`, `sistema_actual`) usando los datos extraídos por el LLM.
   - El código TypeScript evalúa qué variables ya conoce el sistema.
   - **Enrutamiento**:
     - Si `es_spam` es true: Se envía mensaje fijo de rechazo y `status = descartado`.
     - Si `pregunta_precio` es true: Se envía la plantilla de precio (Rule API) y se hace una pregunta.
     - Si ya se conocen 3 de los 4 datos clave: Se envía **INMEDIATAMENTE** la propuesta de piloto con link de agendamiento (`action = propose_pilot`) sin consultar al LLM.
     - Si faltan datos: Se selecciona el dato faltante de mayor prioridad y se envía una pregunta **hardcodeada** (ej. `"¿Cuántas hectáreas administras?"` o `"¿En qué país está tu finca?"`).
     - Al turno 4 (bajamos el límite para cerrar más rápido), si no se han conseguido todos los datos, igual se dispara el `propose_pilot`.

## Beneficios
- **Cero Redundancia:** Las preguntas están harcodeadas y atadas a campos nulos en la base de datos. Si el país ya no es nulo, el código jamás preguntará por el país.
- **Cierre Rápido 100% Garantizado:** El if/else determina cuándo agendar sin depender de la interpretación del LLM sobre un "score".
- **Respuestas Cortas:** Todos los mensajes de salida son plantillas cortas programadas por el equipo, eliminando los párrafos largos y aburridos del LLM.

## Pasos de Implementación
1. Actualizar `src/types/dominio/SDRTypes.ts` con el nuevo `ExtraccionSDRSchema`.
2. Crear `sdr/prompts/SP-SDR-02-extractor.md`.
3. Modificar `IWasagroLLM.ts` y `WasagroAIAgent.ts` para soportar la función `extraerDatosSDR(texto, contexto)`.
4. Refactorizar `handleSDRSession` en `src/agents/sdrAgent.ts` para usar este nuevo flujo de extracción e if/else.
5. Actualizar/Reescribir los tests unitarios.