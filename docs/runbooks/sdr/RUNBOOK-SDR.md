# Runbook SDR — Wasagro

> Flujos operativos repetibles para el agente SDR.
> Cargar este runbook cuando la tarea involucre: agregar intents, modificar el FSM, diagnosticar bugs de clasificación, o trabajar en el pipeline de mensajes SDR.
>
> **No es documentación descriptiva. Es una lista de pasos ejecutables.**

---

## Cómo está organizado este archivo

Cada runbook tiene:
- **Frontmatter de versionamiento** — para que un runbook stale se detecte
- **When to use / When NOT to use** — explicit applicability
- **Pasos numerados** con código real (no pseudocode)
- **Expected output** — sample de salida exitosa
- **Criterio de éxito medible** — qué métrica/grep/test confirma que terminó

---

## Dependency graph entre runbooks

```
INC-01 (incidentes)          ← cuando algo está roto en prod (otro file)
   ↓
SDR-02 (diagnóstico)         ← bug reportado, causa desconocida
   ↓
   ├─→ SDR-01 (agregar intent)    si síntoma = 'other' frecuente
   ├─→ SDR-03 (template roto)     si síntoma = mensaje mal estructurado
   ├─→ SDR-04 (achicar SP)        si síntoma = LLM ignora reglas del prompt
   └─→ (fix manual + nueva prueba) si síntoma = otro

SDR-05 (monitoreo semanal)   ← preventivo, detectar bugs antes de que rompan
   → puede disparar SDR-01, SDR-04 según métrica que se desvió

SDR-06 (gate Fase C)         ← bloqueante: PR de ConvContext no merge sin pasar este
   ← prerequisito para SDR-01, SDR-03 (necesitan ConvContext hidratado)
```

**Orden de prerequisitos:** SDR-06 debe estar verde antes de aplicar SDR-01 o SDR-03 en el código que usa `ConvContext`. SDR-02 y SDR-04 pueden correr en cualquier momento. SDR-05 es independiente (monitoreo).

---

## Índice por síntoma (cómo entrar al runbook correcto)

| Síntoma | Runbook |
|---|---|
| El agente respondió algo que no tiene sentido | SDR-02 |
| `intent = 'other'` frecuente para un patrón nuevo | SDR-01 |
| Mensaje sin pregunta al final / estructura rota | SDR-04 |
| Template genera texto con `[undefined]` o slot vacío | SDR-03 |
| Métricas de LangFuse fuera de umbral | SDR-05 |
| Fase C lista para merge (PR de ConvContext) | SDR-06 |
| Bug reproducible pero causa desconocida | SDR-02 → paso 3 (clasificar tipo de falla) |

---

## RUNBOOK-SDR-01 — Agregar un nuevo Intent al FSM

```yaml
---
runbook: SDR-01
version: 1.0.0
last_validated: 2026-05-31
validated_by: claude-opus-4-7
applies_to_commit_range: post-Fase-B (requiere src/constants/intents.ts)
status: pending-fase-B
---
```

### When to use
- `intent = 'other'` rate > 10% en LangFuse durante 3+ días consecutivos
- Decisión explícita de producto para cubrir un nuevo patrón conversacional
- Patrón observado ≥5 veces en `sdr_interacciones` con `action_taken = 'global_fallback_answered'`

### When NOT to use
- Si `intent = 'other'` rate < 5% → costo de mantenimiento supera el beneficio
- Si el patrón solo apareció una vez → puede ser ruido del modelo, esperar más muestras
- Si el FSM no tiene transición razonable para el nuevo intent → falta diseño de producto primero
- Si Fase B aún no merge (no existe `src/constants/intents.ts`) → escalar al refactor antes

### Pre-condiciones
- Fase B completa (ADR-009) → `src/constants/intents.ts` y `src/agents/sdr/classifier.ts` existen
- Fase C completa → ConvContext hidratado disponible para el classifier
- Acceso a LangFuse para confirmar la frecuencia del patrón

### Pasos

**1. Definir el intent en la fuente de verdad**
```ts
// src/constants/intents.ts (única source of truth)
export const IntentEnum = z.enum([
  'wants_brochure', 'booked', 'will_book_later',
  'advance', 'objection_price', 'objection_time',
  'declined', 'other',
  'nuevo_intent',  // ← agregar con comentario de qué lo dispara
])
```

**2. Agregar ejemplos few-shot al classifier**
```ts
// src/agents/sdr/classifier.ts — ejemplos reales de LangFuse, no inventados
// Mínimo 3 positivos + 2 negativos (qué NO es este intent)
```
Buscar 3 mensajes reales en `sdr_interacciones` que califiquen para el nuevo intent. **No inventar texto** — si no hay datos reales, esperar más muestras.

**3. Mapear el intent → transición en el FSM**
```ts
// src/agents/sdr/router.ts — el FSM decide, el classifier solo clasifica
// Agregar el case del nuevo intent en cada fsmState donde aplica
```

**4. Agregar template** (si el intent requiere respuesta nueva con estructura fija)
```
src/agents/sdr/skills/templates/nuevo-intent.ts
```
Patrón: ver SDR-03.

**5. Registrar el auto-fix en validators**
```ts
// src/agents/sdr/validators.ts — Fase D
// Si classifier devuelve nuevo_intent con confidence < 0.7 → fallback con telemetría
```

**6. Test antes de mergear**
```bash
# Tests viven en tests/ (path real del repo)
npm test -- tests/agents/sdr/classifier.test.ts
```
Mínimo: 3 casos positivos + 2 negativos + 1 caso de ConvContext vacío que no explote.

**7. Verificar en LangFuse post-deploy** (después del primer día en prod)
- Buscar `intent = 'nuevo_intent'` en traces de últimas 24h
- Confirmar `intent = 'other'` bajó del threshold que disparó el runbook

### Expected output (criterio de éxito)
- LangFuse muestra `nuevo_intent` activado ≥5 veces en las primeras 48h en prod
- `intent = 'other'` rate bajó al menos 50% respecto al valor pre-cambio
- `autoFix` para `nuevo_intent` activado < 10% (si supera → few-shot insuficiente, volver al paso 2)
- mem_save con título "Intent nuevo_intent agregado — rationale + métrica baseline"

---

## RUNBOOK-SDR-02 — Diagnosticar un bug de clasificación

```yaml
---
runbook: SDR-02
version: 1.0.0
last_validated: 2026-05-31
validated_by: claude-opus-4-7
applies_to_commit_range: HEAD
status: active
---
```

### When to use
- El agente SDR respondió algo incorrecto a un mensaje real del prospecto
- Hay sospecha de que el classifier asignó intent equivocado
- Aparece un patrón nuevo en `sdr_interacciones.action_taken` con valores inesperados

### When NOT to use
- Si el bug es de envío de WhatsApp (HTTP error, webhook 403, etc.) → no es classifier, ver runbook de incidentes (`docs/runbooks/incidents/`)
- Si el bug es de UI del dashboard → no aplica, otro pipeline
- Si no se tiene el trace exacto en LangFuse → primero capturar el caso, luego volver

### Pasos

**1. Recuperar el trace en LangFuse**
- Buscar por `phone = "+593XXXXXXXXX"` AND `timestamp >= [momento del bug]`
- Revisar: input al classifier, ConvContext en ese turno, intent devuelto, confidence

**2. Verificar si ConvContext estaba hidratado**
Si el trace muestra `lastBotAction: null` o `lastBotMessage: null` cuando no debería → el bug es de Fase C (hidratación), no del classifier. Escalar al PR de ConvContext.

**3. Clasificar el tipo de falla**

| Síntoma en el trace | Causa raíz | Runbook a seguir |
|---|---|---|
| `intent: 'other'`, confidence < 0.4 | Patrón no cubierto por few-shot | SDR-01 |
| `intent: X` correcto pero FSM tomó rama Y | Mismatch de strings entre `src/constants/intents.ts` y `src/agents/sdr/router.ts` | Fix en constants — Fase B |
| `intent` correcto, respuesta mal estructurada | Template usa slot null de ConvContext | SDR-03 + verificar hidratación |
| `autoFix` activado pero mensaje sigue mal | La corrección determinística está rota | Revisar `validators.ts` Fase D |
| No hay trace en LangFuse | Llamada LLM sin instrumentación | Agregar `langfuse.trace()` en el nodo |
| `intent` correcto pero JSON parse falló | Anti-pattern: `redactarMensajeSDR` usado para JSON | Grep `JSON\.parse\(.+(redactar|generar)` y migrar a `clasificarIntencionSDR` |

**4. Reproducir en test antes de tocar producción** (P principio "Reproduce before fix")
```bash
# Tests viven en tests/
npm test -- tests/agents/sdr/<archivo>.test.ts -t "reproduce bug YYYY-MM-DD <input>"
```
Si no se puede reproducir → el fix es especulativo. No mergear.

**5. Fix determinístico, NO en el system prompt**
- Si el fix es "agregar una regla" → SDR-01 o SDR-04
- Si el fix es "corregir un template" → editar `src/agents/sdr/skills/templates/`
- Si el fix es "el FSM tomó la rama equivocada" → revisar transiciones en `src/agents/sdr/router.ts`
- **NUNCA:** agregar regla al system prompt para parchar el bug

### Expected output (criterio de éxito)
- Test rojo creado en paso 4 que reproduce el bug
- Test verde después del fix mínimo
- Causa raíz documentada en mem_save con topic_key `sdr/bug-{síntoma-corto}`
- Si la causa fue patrón sistémico → entrada nueva en ADR-009 o creación de ADR nuevo

---

## RUNBOOK-SDR-03 — Agregar o modificar un Template de mensaje

```yaml
---
runbook: SDR-03
version: 1.0.0
last_validated: 2026-05-31
validated_by: claude-opus-4-7
applies_to_commit_range: post-Fase-A (requiere src/agents/sdr/skills/templates/)
status: pending-fase-A
---
```

### When to use
- Se necesita nuevo mensaje estructural (close, brochure, confirmación, rechazo)
- Se modifica template existente porque copy quedó obsoleto
- Se detectó promesa falsa en un mensaje (e.g., "casos de éxito" cuando no existen)

### When NOT to use
- Si el mensaje necesita creatividad real por contexto (pitch body) → no es template, es LLM con directiva atómica
- Si el cambio es solo de tono → editar el writer prompt (`sdr/prompts/SP-SDR-03-writer.md`), no template
- Si Fase A no merge aún → `src/agents/sdr/skills/templates/` no existe; escalar el refactor

### Regla de oro
Si el mensaje tiene **estructura fija** (mismo esquema siempre, varían solo slots), es **template**. Si necesita **redacción creativa por contexto**, es **LLM con directiva + composer**.

### Estructura correcta de un template

```ts
// src/agents/sdr/skills/templates/[nombre-kebab-case].ts
import type { ConvContext } from '../../context.js'

// 1. Guard: verificar slots antes de render — nunca asumir ctx completo
function guardClose(ctx: ConvContext): asserts ctx is ConvContext & { cultivo: NonNullable<ConvContext['cultivo']>, segmento: NonNullable<ConvContext['segmento']> } {
  if (!ctx.cultivo || !ctx.segmento) {
    throw new Error(`closeOffer template requiere cultivo y segmento. Recibido: ${JSON.stringify({ cultivo: ctx.cultivo, segmento: ctx.segmento })}`)
  }
}

// 2. Template = función pura (mismo input → mismo output, sin LLM)
export function closeOfferTemplate(ctx: ConvContext): string {
  guardClose(ctx)
  return (
    `Lo que te conté lo vivimos a diario con ${ctx.cultivo}. ` +
    `¿Te parece si vemos 10 min en vivo o te mando el brochure para ${ctx.segmento}?`
  )
}

// 3. Si el template tiene pool de variaciones (CTAs, frases de empatía):
export const CLOSE_CTAS = [
  '¿Te hace sentido para tu finca?',
  '¿Cómo registran hoy lo que pasa en el lote?',
  '¿Esto resuena con lo que vivís a diario?',
] as const
```

### Cómo se usa desde el composer

```ts
// src/agents/sdr/composer.ts
import { closeOfferTemplate } from './skills/templates/close-offer.js'
import { ctaPicker } from './skills/cta-picker.js'

export async function buildMessage(state: SDRState, ctx: ConvContext, llm: IWasagroLLM): Promise<string> {
  // Mensajes 100% determinísticos
  if (state === 'closing') return closeOfferTemplate(ctx)

  // Mensajes con body LLM + CTA determinístico (e.g. pitch)
  if (state === 'pitch_sent') {
    const body = await llm.generarPitchBody({ ctx, directive: 'Solo el cuerpo, 2-3 oraciones.' })
    const cta = ctaPicker.pick('pitch', ctx)
    return `${body}\n\n${cta}`
  }

  throw new Error(`buildMessage: no template para state=${state}`)
}
```

### Pasos para agregar template nuevo

1. Crear archivo `src/agents/sdr/skills/templates/<nombre>.ts` con guard + función pura
2. Registrar en `src/agents/sdr/skills/registry.ts` (mapeo `state → template`)
3. Test:
   ```bash
   npm test -- tests/agents/sdr/templates/<nombre>.test.ts
   ```
   Mínimo: render con ctx completo + render con slot null → throw esperado
4. Anti-pattern guard #5 debe seguir devolviendo 0 matches:
   ```bash
   rg 'TEMPLATES\s*=\s*\{' src/agents/sdr/
   ```

### Expected output (criterio de éxito)
- Nuevo archivo en `src/agents/sdr/skills/templates/` (no en `composer.ts`)
- Entry en `src/agents/sdr/skills/registry.ts` para el nuevo template
- Test pasando con ≥2 casos (happy path + guard fail)
- Composer sigue corto: cero strings hardcoded

---

## RUNBOOK-SDR-04 — Achicar el System Prompt de un nodo

```yaml
---
runbook: SDR-04
version: 1.0.0
last_validated: 2026-05-31
validated_by: claude-opus-4-7
applies_to_commit_range: HEAD (aplicable a prompts existentes)
status: active
---
```

### When to use
- System prompt de un nodo supera 400 tokens
- Tiene más de 3 reglas en sección "ESTRICTO"
- Alguna regla es de estructura ("termina con X", "no digas Y", "máximo Z palabras")
- LangFuse muestra que el LLM ignora ≥10% de las veces una regla del prompt

### When NOT to use
- Si el SP tiene <200 tokens y solo reglas de tono/rol → ya está bien, no tocar
- Si las reglas son de seguridad (anti prompt-injection) → quedan en el SP siempre
- Si el nodo es de Fase A pendiente → el refactor ya las saca; esperar

### Principio
El SP define **una sola cosa por nodo** (tono, o brevedad, o rol). Las restricciones de estructura las garantiza el código (templates Fase A, validators Fase D).

### Checklist de reducción

```
□ Identificar cuántas "reglas" tiene el SP actual (contar items en ESTRICTO/Reglas)
□ Por cada regla, clasificar:
    → "Es de tono o rol" → queda en el SP
    → "Es de estructura/formato/length" → mover a validators.ts o composer.ts
    → "Es un caso edge de negocio" → mover al runbook correspondiente
□ Reescribir SP con máximo 3 directivas: (1) rol/persona, (2) tono, (3) brevedad
□ Verificar que lo que se sacó del SP tiene cobertura en validators.ts (no se perdió)
□ Run npm test → confirmar que tests no se rompen
□ mem_save con título "SP del nodo X achicado — N tokens → M tokens"
```

### Ejemplo aplicado — SP-SDR-03 antes/después

```
ANTES — 5 reglas, el LLM ignora alguna:

  "Eres el agente SDR de Wasagro. Genera un aha moment personalizado.
   ESTRICTO:
   - NO agendar demo todavía
   - SÍ terminar con pregunta
   - NO mencionar casos de éxito
   - MAX 90 palabras
   - Tono cálido con voseo"

DESPUÉS — 1 directiva, el código garantiza el resto:

  "Eres el agente SDR de Wasagro. Tono cálido, voseo latinoamericano, sin tecnicismos."

El código garantiza:
  → "No agendamiento" → lo decide el FSM, no el LLM (router.ts transición)
  → "Termina con pregunta" → composer.ts appendea CTA determinístico (Fase A)
  → "Sin casos de éxito" → validators.ts filtra términos prohibidos (Fase D)
  → "Max 90 palabras" → validators.ts maxWords(90) con autoFix truncate
```

### Expected output (criterio de éxito)
- Token count del SP nuevo < 200 (verificable con `wc -w` aproximado o tokenizer real)
- Antes/después documentados en commit message del PR
- mem_save con `topic_key = sdr/prompts-shrink/<nombre-nodo>`
- Si el comportamiento cambia post-deploy en >5% de mensajes → revertir y revisar qué validator faltó

---

## RUNBOOK-SDR-05 — Monitoreo semanal de salud del classifier

```yaml
---
runbook: SDR-05
version: 1.0.0
last_validated: 2026-05-31
validated_by: claude-opus-4-7
applies_to_commit_range: post-Fase-D (requiere validators con métricas)
status: pending-fase-D
---
```

### When to use
- Revisión preventiva semanal (15 min cada lunes)
- Después de cualquier deploy que toque SDR
- Cuando un cliente reporta degradación sin caso específico identificable

### When NOT to use
- Si Fase D no merge → no hay métricas que monitorear, escalar refactor primero
- Como sustituto de SDR-02 cuando hay bug específico — usar el runbook directo del bug

### Métricas a revisar (umbrales de alerta)

| Métrica | Saludable | Alerta | Acción |
|---|---|---|---|
| `intent = 'other'` rate | < 8% | > 10% | SDR-01 |
| `confidence < 0.7` rate | < 15% | > 20% | Revisar few-shot del classifier |
| `autoFix endsWithQuestion` activaciones | < 5% | > 10% | SDR-04 (achicar SP del nodo) |
| `autoFix maxSentences` activaciones | < 5% | > 10% | Directiva atómica muy vaga |
| `ConvContext.cultivo = null` rate | < 10% | > 20% | Bug en hidratación de Fase C |
| Tiempo de respuesta al prospecto | < 8s | > 15s | Revisar modelo del nodo (tier 'fast' vs 'reasoning') |
| Mensajes sin trace en LangFuse | 0% | > 0% | Nodo sin instrumentación — fix inmediato |
| `mentionsBotCanDeliver` (promesas falsas) | 0% | > 1% | Prompt menciona feature inexistente — fix en SP o template |

### Cómo generar el reporte

Cuando exista el script (Fase D):
```bash
# Path propuesto: scripts/monitoring/sdr-health-report.ts [FASE D — pendiente]
npx tsx scripts/monitoring/sdr-health-report.ts --days 7
```

Mientras tanto, query manual en LangFuse UI con los topics:
- `sdr_intent_classification` filtrado por última semana
- `sdr_validator_activated`

### Expected output (criterio de éxito)

```
SDR Health Report — semana 2026-05-25 al 2026-05-31
intentFallbackRate:     6.2%   ✅
lowConfidenceRate:      11.4%  ✅
autoFix.endsWithQ:      3.1%   ✅
autoFix.maxSentences:   7.8%   ⚠️  → revisar directiva de PITCH_SENT
convContextNullRate:    8.3%   ✅
avgResponseTime:        4.2s   ✅
missingTraces:          0      ✅
mentionsBotCanDeliver:  0      ✅
```

Si alguna métrica está en alerta → seguir la acción de la tabla y crear issue/mem_save con el contexto.

---

## RUNBOOK-SDR-06 — Gate de validación de Fase C (ConvContext)

```yaml
---
runbook: SDR-06
version: 1.0.0
last_validated: 2026-05-31
validated_by: claude-opus-4-7
applies_to_commit_range: PR de Fase C (sdr/refactor-fase-c)
status: bloqueante-de-merge
---
```

### When to use
- Antes de mergear el PR de ConvContext (Fase C del refactor ADR-009)
- Este runbook **es un gate** — si algún check falla, **no se merge**

### When NOT to use
- Si el PR es solo de docs (no toca código de ConvContext) → no aplica
- Si Fase C ya está en main y validada → no re-correr salvo regression suspect

### Checklist de validación

```
□ ConvContext es una función pura — mismo input, mismo output, sin side effects
□ El reducer no hace llamadas LLM — si necesita LLM, el diseño está mal
□ Todos los campos de ConvContext tienen tipo explícito (no `any`, no `unknown` sin Zod)
□ Campos nullable marcados con `| null` (no `?` opcional, para forzar lectura explícita)
□ ConvContext se hidrata ANTES de llamar al classifier — verificar orden en router.ts
□ Test del caso "Ya?" con lastBotAction='sent_brochure' devuelve intent correcto
□ Test de ConvContext vacío (sesión nueva) no explota — devuelve defaults seguros
□ LangFuse loggea ConvContext en cada llamada al classifier (para debug futuro)
□ ADR-009 está actualizado con la implementación real (no solo el diseño)
□ Anti-pattern guard #3 devuelve 0 matches (mutación fuera del reducer)
□ npm test pasa sin warnings
□ npx tsc --noEmit pasa clean
```

### Test crítico del "Ya?" (caso central del ADR-009)

```ts
// tests/agents/sdr/context.test.ts [FASE C — pendiente]
it('clasifica "Ya?" correctamente cuando el bot acaba de enviar brochure', async () => {
  const ctx: ConvContext = {
    prospectId: 'test-1',
    phone: '+5939999',
    cultivo: 'aguacate',
    segmento: 'agricultor',
    fsmState: 'brochure_sent',
    lastBotAction: 'sent_brochure',
    lastBotMessage: '¡Claro! Aquí tu brochure: https://...',
    turnCount: 3,
    intentHistory: ['interest', 'wants_brochure'],
    lastObjectionType: null,
    signalStrength: 'warm',
    datosConocidos: 3,
    clarificationTurnsUsed: 0,
    pais: 'Ecuador',
    fincasEstimadas: 1,
    sistemaActual: null,
  }
  const result = await classifier.clasificarIntent('Ya?', ctx, 'test-trace')
  expect(result.intent).toBe('interest')  // no 'other', no 'objection'
  expect(result.confidence).toBeGreaterThan(0.7)
})
```

### Anti-pattern guards a correr

```bash
# Mutación de prospecto fuera del reducer (#3)
rg 'prospecto\[.+\]\s*=' src/ | rg -v 'src/agents/sdr/context.ts'
# Debe devolver: 0 matches

# Classifier sin ConvContext (#4)
rg 'clasificarIntencionSDR\(' src/ | rg -v 'ConvContext'
# Debe devolver: 0 matches
```

### Expected output (criterio de éxito)

- Los 11 checks del checklist marcados ✅
- Test del "Ya?" verde
- Anti-pattern guards #3 y #4 = 0 matches
- `npm test` y `npx tsc --noEmit` clean
- ADR-009 status actualizado a "Implementado en Fase C" con fecha y commit hash
- mem_save con `topic_key = sdr/fase-c-merged` y observaciones del proceso

**Si cualquier check falla:** NO mergear. Devolver al desarrollador con el item rojo específico.

---
