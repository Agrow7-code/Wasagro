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

## Regla 5: Scope de H0 — Solo estructura de datos, no lógica ejecutable de horizontes futuros

**Criterio:** La distinción no es semántica (qué "parece" de H1) sino **estructural**: ¿el código es estructura de datos o es lógica ejecutable?

- **Estructura de datos** = columnas, tipos, enums, índices, campos con defaults → PERMITIDO siempre, incluso si prepara features de H1/H2
- **Lógica ejecutable** = funciones, condicionales, handlers, endpoints, workflows que procesan datos de features de H1/H2 → PROHIBIDO

### Ejemplos concretos (GGA debe usar estos como referencia):

**✅ PASS — Estructura que prepara futuro:**
```sql
-- Agregar columna para compliance futuro
ALTER TABLE fincas ADD COLUMN eudr_compliant BOOLEAN DEFAULT false;
```

**✅ PASS — Enum con valores futuros:**
```sql
-- Tipos de alerta (algunos se usarán en H2)
CREATE TYPE tipo_alerta AS ENUM ('threshold', 'pattern_based', 'predictive');
```

**✅ PASS — Campo de relación para feature futura:**
```typescript
// Interface que incluye campo opcional para H2
interface FincaProfile {
  id: string;
  nombre: string;
  eudr_compliant?: boolean; // Se usará en H2
}
```

**❌ FAIL — Función con lógica de validación de H1:**
```typescript
// Esta función implementa lógica de compliance que es de H1
function checkEudrCompliance(finca: Finca): ComplianceReport {
  const hasPolygon = finca.poligono !== null;
  const hasPrecision = checkCoordinatePrecision(finca.coordenadas);
  return { compliant: hasPolygon && hasPrecision, issues: [] };
}
```

**❌ FAIL — Condicional con lógica de feature de H2:**
```typescript
// Pattern-based alerts es feature de H2
if (alert.tipo === 'pattern_based') {
  const patterns = await detectPatterns(finca.id, last30Days);
  await notifyGerente(patterns);
}
```

**❌ FAIL — Endpoint para dashboard web (H2):**
```typescript
// Dashboard web es H2
app.get('/api/dashboard/:fincaId', async (req, res) => {
  const stats = await getDashboardStats(req.params.fincaId);
  res.json(stats);
});
```

**❌ FAIL — Router de modelos LLM (H1):**
```typescript
// Router de complejidad es aspiracional para H1
function selectModel(event: FieldEvent): string {
  if (event.hasImage) return 'gpt-4o';
  if (event.complexity > 0.7) return 'gpt-4o';
  return 'gpt-4o-mini';
}
```

**Resumen de la regla:** Si `grep -r "function\|handler\|endpoint\|if.*===\|switch.*case"` encuentra lógica que procesa datos de features listadas como H1/H2 en el CLAUDE.md, es FAIL. Si solo encuentra definiciones de tipos, columnas, enums, o interfaces con campos opcionales, es PASS.

## Convenciones de calidad (warnings, no FAIL)

GGA debe señalar estos como warnings:

- **SQL sin migración numerada:** Todo cambio al schema debe ser un archivo `XX-patch-nombre.sql`
- **Prompt sin referencia a Voz y Tono:** System prompts deben seguir las reglas de vocabulario prohibido y tuteo
- **Secrets en código:** Ninguna API key, token, o credencial hardcodeada
- **Funciones críticas sin test:** Pipeline de extracción, clasificación, validación → al menos un happy path test
