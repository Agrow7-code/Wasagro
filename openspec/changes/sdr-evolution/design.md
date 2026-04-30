# Diseño Técnico: Evolución SDR 2026

## 1. Cambios en Base de Datos & Tipos (Zod)
**Archivos Afectados:**
- `src/types/dominio/SDRTypes.ts`
- `src/integrations/whatsapp/NormalizedMessage.ts` (si es necesario)
- Nueva migración en `supabase/migrations/`

**Modificaciones:**
1. `NormalizedMessage`: Añadir `source_context?: string`.
2. `RespuestaSDRSchema` (en `SDRTypes.ts`):
```typescript
export const RespuestaSDRSchema = z.object({
  reflection: z.string().describe('Razonamiento sobre lo que falta por saber o el estado actual.'),
  plan: z.string().describe('Plan para la siguiente pregunta o acción.'),
  respuesta: z.string(),
  preguntas_respondidas: z.array(PreguntaRespondidaSchema).default([]),
  score_delta: ScoreDeltaSchema,
  action: z.enum([
    'continue_discovery', 
    'propose_pilot', 
    'handle_objection', 
    'request_pricing', // <-- Nueva acción
    'graceful_exit'
  ]),
  objection_type: z.string().nullable().default(null),
  requires_founder_approval: z.boolean().default(false),
  deal_brief: z.unknown().nullable().default(null),
  segmento_icp: z.string().optional(),
})
```
3. Base de Datos: La tabla `sdr_prospectos` requiere guardar el `source_context`.
   - Crear migración `2026..._add_sdr_source_context.sql` que añada `source_context TEXT` a `sdr_prospectos`.

## 2. Lógica del Guardarraíl de Precios
**Archivo Afectado:** `src/agents/sdrAgent.ts`
- Crear función determinista: `function calcularPrecio(segmento_icp: string, fincas: number): string`
- En `handleSDRSession`, después de recibir `resultado` del LLM, interceptar:
```typescript
if (resultado.action === 'request_pricing') {
  const precioInfo = calcularPrecio(prospecto.segmento_icp, prospecto.fincas_en_cartera || 0);
  resultado.respuesta = `Nuestros planes para ${prospecto.segmento_icp} comienzan en ${precioInfo}. ¿Cómo lo ves para tu operación?`;
  // Opcional: registrar el evento en langfuse
}
```

## 3. Secuencias de Persecución (Chasers)
**Archivos Afectados:** 
- `src/workers/pgBoss.ts` (configuración del queue si no existe)
- `src/agents/sdrAgent.ts`

**Implementación:**
- Al final de `handleSDRSession`, encolar un trabajo:
```typescript
import { boss } from '../workers/pgBoss.js'
// ...
await boss.send('sdr_chaser', {
  prospecto_id: prospecto.id,
  expected_turn: nuevoTurno
}, { startAfter: 20 * 3600 }) // 20 horas
```
- Crear el handler del worker (`src/workers/sdrChaserWorker.ts`):
```typescript
export async function sdrChaserHandler(job: pgBoss.Job) {
  const { prospecto_id, expected_turn } = job.data;
  const prospecto = await getSDRProspectoById(prospecto_id);
  
  if (prospecto.turns_total !== expected_turn) {
    return; // Abortar, el prospecto ya respondió
  }
  
  // Enviar plantilla de reenganche
  const mensaje = "Hola, ¿pudiste revisar la información? Sigo por aquí si tienes dudas. 🚜";
  await sender.enviarTexto(prospecto.phone, mensaje);
  
  // Registrar interacción outbound
  await saveSDRInteraccion({ ... , tipo: 'outbound', contenido: mensaje });
}
```

## 4. Inyección CTWA
**Archivo Afectado:** `src/pipeline/procesarMensajeEntrante.ts`
- Modificar la creación de prospectos (`handleSDRSession` o `procesarMensajeEntrante`) para parsear el mensaje y, si hay contexto de origen (ej. un referral de webhook meta o una palabra clave), inicializar la DB con él.

## 5. Actualización de Prompts
**Archivos Afectados:** `prompts/SP-SDR-01-master.md` y similares
- Incluir instrucciones explícitas sobre NO generar precios, usar `request_pricing`, y utilizar `plan` y `reflection` internamente antes de generar `respuesta`.