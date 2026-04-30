# Diseño y Tareas: SDR Extractor Determinista

## Especificaciones

**1. Extractor LLM (JSON Only)**
- El LLM solo debe parsear el mensaje actual (con algo de historial) y retornar un JSON.
- Campos a extraer:
  - `fincas_en_cartera`: número (hectáreas o fincas).
  - `cultivo_principal`: texto (ej. "banano", "cacao").
  - `pais`: texto (ej. "Ecuador").
  - `sistema_actual`: texto (ej. "Excel", "papel").
  - `es_spam`: booleano (true si habla de cosas ajenas al agro).
  - `pregunta_precio`: booleano.

**2. Lógica TypeScript (sdrAgent.ts)**
- Recibe el JSON del LLM.
- Actualiza los campos en la BD (`sdr_prospectos`).
- Evalúa el estado del prospecto consultando los 4 campos clave en la BD.
- Respuestas fijas (hardcoded):
  - Si falta `fincas_en_cartera`: "¡Genial! ¿Cuántas hectáreas o fincas administras actualmente?"
  - Si falta `cultivo_principal`: "¿Qué tipo de cultivo principal tienen en la finca?"
  - Si falta `pais`: "¿En qué país está ubicada tu operación?"
  - Si falta `sistema_actual`: "¿Cómo registran actualmente las labores o aplicaciones de insumos? ¿Usan papel, Excel u otra herramienta?"
- **Cierre Rápido:** Si se tienen 3 de los 4 datos (o se llega al turno 4), enviar mensaje de cierre:
  "Me parece que Wasagro es ideal para ti. Para mostrarte cómo funciona, agendemos una breve llamada de 15 minutos." + `DEMO_BOOKING_URL`.

## Diseño Técnico

**1. Zod Schema (`SDRTypes.ts`)**
```typescript
export const ExtraccionSDRSchema = z.object({
  fincas_en_cartera: z.number().nullable(),
  cultivo_principal: z.string().nullable(),
  pais: z.string().nullable(),
  sistema_actual: z.string().nullable(),
  es_spam: z.boolean(),
  pregunta_precio: z.boolean(),
})
export type ExtraccionSDR = z.infer<typeof ExtraccionSDRSchema>
```

**2. IWasagroLLM y WasagroAIAgent**
- Añadir método: `extraerDatosSDR(texto: string, contextoActual: string, traceId: string): Promise<ExtraccionSDR>`
- Usar prompt `SP-SDR-02-extractor.md`.

## Tareas (sdd-tasks)
- [ ] 1. Crear el nuevo prompt `prompts/SP-SDR-02-extractor.md`.
- [ ] 2. Modificar `SDRTypes.ts` añadiendo `ExtraccionSDRSchema` y eliminando `RespuestaSDRSchema`.
- [ ] 3. Modificar `IWasagroLLM.ts` y `WasagroAIAgent.ts` para implementar `extraerDatosSDR`.
- [ ] 4. Reescribir `handleSDRSession` en `sdrAgent.ts` para utilizar `extraerDatosSDR` y la lógica de enrutamiento if/else con plantillas fijas.
- [ ] 5. Actualizar `tests/agents/sdrAgent.test.ts` para cubrir la nueva lógica determinista.