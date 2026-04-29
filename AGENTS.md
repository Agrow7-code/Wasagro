# Wasagro — AGENTS.md

> Reglas que GGA verifica en cada commit. Condiciones de PASS/FAIL. Si el código viola alguna, el commit se rechaza.

## Regla 1: El agente nunca inventa datos

**FAIL si:** El código genera, fabrica, o asume valores para campos de datos agrícolas sin input del usuario.

Esto incluye:
- Hardcodear un `lote_id`, `product_name`, `dose`, o cualquier campo de `eventos_campo` sin que venga del input del usuario
- Usar valores por defecto para campos de dominio agrícola (ej: `dose = dose || 1` es FAIL)
- Generar datos de prueba que se mezclen con datos reales (datos de prueba deben estar en archivos separados con prefijo `test_` o `mock_`)

**PASS si:** Todo dato de dominio agrícola proviene del input del usuario o está marcado explícitamente como `confidence_score < 0.5` con `requiere_validacion = true`.

**Excepción:** Timestamps, UUIDs, y metadatos del sistema SÍ se generan automáticamente.

## Regla 2: Loop de clarificación tiene máximo 2 preguntas

**FAIL si:** El código del agente permite más de 2 rondas de preguntas de clarificación antes de dar una respuesta útil.

Verificar en:
- Lógica de flujo conversacional: debe haber un contador o estado que limite a 2 clarificaciones
- Después de 2 clarificaciones sin completar, el sistema debe registrar como `tipo_evento = 'nota_libre'` con `status = 'requires_review'`
- No debe existir un loop infinito de preguntas

**PASS si:** Existe un mecanismo explícito (contador, estado, condición) que limita las clarificaciones a 2 y tiene fallback definido.

## Regla 3: Ninguna acción irreversible sin aprobación humana

**FAIL si:** El código ejecuta acciones que no se pueden deshacer sin confirmación explícita del usuario o un operador.

Acciones irreversibles incluyen:
- `DELETE` en tablas de producción (sin soft-delete)
- Envío de mensajes WhatsApp que modifiquen datos o recomienden acciones de campo
- Modificación de polígonos de geolocalización
- Cambio de estado de consentimiento sin input del usuario

**PASS si:** Toda acción irreversible tiene un paso de confirmación (puede ser `requiere_validacion = true`, approval workflow, o confirmación explícita del usuario).

**Excepción:** Inserts de nuevos eventos y confirmaciones de lectura son reversibles y no requieren aprobación.

## Regla 4: Todo error de extracción se loggea

**FAIL si:** El código procesa un input del usuario y no registra el resultado en el sistema de observabilidad.

Verificar:
- Toda llamada a LLM para extracción debe tener logging (LangFuse o equivalente)
- El log debe incluir: input raw, output estructurado, `confidence_score`, modelo usado, latencia
- Los errores de STT deben loggearse con el audio original referenciado
- No debe existir un path donde un error se trague silenciosamente (no `catch` vacío, no `catch(e) {}`)

**PASS si:** Hay logging explícito en toda la cadena: recepción → STT → LLM → extracción → persistencia.

## Regla 5: No lógica ejecutable para features NO documentadas en CLAUDE.md Capa 3

**Criterio principal:** La referencia de verdad es **CLAUDE.md Capa 3 — Decisiones actuales** (D1–D9 y las que se agreguen). Si una feature tiene una decisión documentada ahí, su lógica ejecutable está aprobada. Si NO tiene decisión en Capa 3, no se puede implementar lógica ejecutable.

**La distinción no es semántica** (qué "parece" de H1 o H2). Es estructural: ¿el código es estructura de datos o es lógica ejecutable para una feature aprobada?

- **Estructura de datos** = columnas, tipos, enums, índices, campos con defaults → PERMITIDO siempre, incluso si prepara features no documentadas aún
- **Lógica ejecutable para feature aprobada en Capa 3** → PERMITIDO
- **Lógica ejecutable para feature NO en Capa 3** → FAIL

### Cómo verificar (proceso GGA):

1. Identificar qué feature implementa el código
2. Buscar en `CLAUDE.md` → **Capa 3 — Decisiones actuales**
3. Si existe una decisión (D1, D2, D3... Dn) que cubra esa feature → PASS
4. Si no existe ninguna decisión → FAIL

### Ejemplos concretos (GGA debe usar estos como referencia):

**✅ PASS — Estructura que prepara futuro (siempre permitido):**
```sql
-- Agregar columna para compliance futuro
ALTER TABLE fincas ADD COLUMN eudr_compliant BOOLEAN DEFAULT false;
```

**✅ PASS — Enum con valores futuros (siempre permitido):**
```sql
-- Tipos de alerta (algunos se usarán en H2)
CREATE TYPE tipo_alerta AS ENUM ('threshold', 'pattern_based', 'predictive');
```

**✅ PASS — Router tiered de LLM (aprobado en D3):**
```typescript
// Router documentado en CLAUDE.md D3 — aprobado para H0-R
class LLMRouter {
  async generarTexto(content: string, opciones: LLMGeneracionOpciones): Promise<string> {
    const adapter = this.selectAdapter(opciones.modelClass)
    return adapter.generarTexto(content, opciones)
  }
}
```

**✅ PASS — Clasificador de imágenes (aprobado en D7):**
```typescript
// Clasificación de imágenes documentada en CLAUDE.md D7
async clasificarTipoImagen(base64: string, mimeType: string, traceId: string): Promise<TipoImagen>
```

**✅ PASS — Descarga de media Evolution API (aprobado en D8):**
```typescript
// EvolutionMediaClient documentado en CLAUDE.md D8
export async function downloadEvolutionMedia(rawPayload: unknown, ...): Promise<MediaResult>
```

**❌ FAIL — Función con lógica de validación EUDR (no documentada en Capa 3):**
```typescript
// EUDR compliance no está en ninguna decisión de CLAUDE.md Capa 3
function checkEudrCompliance(finca: Finca): ComplianceReport {
  const hasPolygon = finca.poligono !== null;
  return { compliant: hasPolygon, issues: [] };
}
```

**❌ FAIL — Alertas pattern-based (no documentadas en Capa 3):**
```typescript
// Pattern-based alerts no tiene decisión en CLAUDE.md Capa 3
if (alert.tipo === 'pattern_based') {
  const patterns = await detectPatterns(finca.id, last30Days);
  await notifyGerente(patterns);
}
```

**❌ FAIL — Endpoint para dashboard web (no documentado en Capa 3):**
```typescript
// Dashboard web no tiene decisión en CLAUDE.md Capa 3
app.get('/api/dashboard/:fincaId', async (req, res) => {
  const stats = await getDashboardStats(req.params.fincaId);
  res.json(stats);
});
```

**Resumen:** Antes de hacer FAIL, GGA debe leer CLAUDE.md Capa 3 y verificar si la feature tiene decisión documentada. Si la tiene → PASS. Si no la tiene → FAIL con mensaje: "Feature sin decisión en CLAUDE.md Capa 3. Documentar en D[N] antes de implementar."

## Convenciones de calidad (warnings, no FAIL)

GGA debe señalar estos como warnings:

- **SQL sin migración numerada:** Todo cambio al schema debe ser un archivo `XX-patch-nombre.sql`
- **Prompt sin referencia a Voz y Tono:** System prompts deben seguir las reglas de vocabulario prohibido y tuteo
- **Secrets en código:** Ninguna API key, token, o credencial hardcodeada
- **Funciones críticas sin test:** Pipeline de extracción, clasificación, validación → al menos un happy path test
