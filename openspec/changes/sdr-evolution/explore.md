# Exploración: Evolución del Agente SDR

## 1. Saludo Contextual Inteligente (CTWA)
- **Estado actual**: `handleSDRSession` en `sdrAgent.ts` crea nuevos prospectos de forma genérica asignando una narrativa (A/B) aleatoria. No captura contexto de campañas (CTWA).
- **Hallazgo**: `NormalizedMessage` o la API de WhatsApp debe parsear el atributo de "referral" (CTWA) para obtener la fuente de origen. Este contexto debe pasarse en `EntradaSDR` para que el LLM empiece la conversación enfocada en el producto de interés.

## 2. Descomposición Entrelazada (Planificar-Actuar-Reflexionar)
- **Estado actual**: Se hace una llamada simple al LLM (`llm.atenderSDR(entrada)`). El LLM responde, detecta objeciones en texto y extrae preguntas respondidas.
- **Hallazgo**: Hay que actualizar el System Prompt del SDR y la estructura `RespuestaSDRSchema` en `SDRTypes.ts` para que el LLM exponga su "Plan" (qué dimensión calificar después) y su "Reflexión" (qué entendió del usuario), antes de emitir la "respuesta" (Acción).

## 3. Guardarraíles Deterministas (Rule API)
- **Estado actual**: No hay control determinista sobre las cotizaciones. El LLM podría alucinar un precio.
- **Hallazgo**: Debemos introducir una acción nueva en `RespuestaSDRSchema` (ej. `request_pricing`). Cuando el LLM elija esta acción, el código determinista en `sdrAgent.ts` debe interceptar la solicitud, consultar una tabla o constante de precios según las características del prospecto (hectáreas, etc.) e inyectarlo en un mensaje seguro.

## 4. Transferencia Inteligente (Smart Handoff)
- **Estado actual**: Ya existe `detectarHandoffTrigger` (human request / price readiness) y la generación de un `deal_brief` (notificación al founder).
- **Hallazgo**: Se debe enriquecer el handoff para que, si se transfiere a un humano (por ej., vía Langfuse, o notificando al CRM), el resumen (`deal_brief`) contenga explícitamente el tamaño de la finca, problema y todo el contexto, y que se integre con la lógica de Notificación al Founder existente, asegurando que se retome exactamente donde quedó la charla.

## 5. Secuencias de Persecución (Chaser Sequences)
- **Estado actual**: `SDRProspectoRow` guarda estados y la última interacción, pero no hay un mecanismo para despertar prospectos dormidos cerca de las 24 hrs.
- **Hallazgo**: Hay que crear una tarea asíncrona usando `pgBoss.ts`. Cada vez que el prospecto habla, se programa un job para dentro de 20 horas. Si el usuario no respondió, este job ejecuta una plantilla de reenganche. Si ya pasaron las 24 hrs, se usan plantillas de marketing pre-aprobadas de Meta.