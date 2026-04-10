# Exploración: pipeline-procesamiento-whatsapp

> Fase: sdd-explore | Fecha: 2026-04-09 | Estado: completo

---

## Resumen ejecutivo

Wasagro necesita un pipeline de procesamiento de mensajes WhatsApp que convierta inputs crudos (texto, audio `.opus`, imagen) en eventos de campo estructurados y persistidos en Supabase. El pipeline es el núcleo operativo del producto en H0: sin él, no existe captura de datos de campo. El diseño debe cumplir tres restricciones no negociables: latencia total <30s (acuse en <5s), máximo 2 preguntas de clarificación antes de fallback a `nota_libre`, y logging completo en LangFuse de cada llamada LLM/STT.

---

## Contexto existente

### Archivos en el repo (2026-04-09)

El repositorio tiene estructura mínima. Los directorios `backend/sql/`, `docs/`, `flows/` y `prompts/` referenciados en CLAUDE.md **no existen aún** en el filesystem local. Solo existen:

- `CLAUDE.md` — steering del proyecto (principios, criterios, decisiones D1-D6)
- `AGENTS.md` — guardrails R1-R5 para GGA
- `README.md` — vacío
- `openspec/config.yaml` — configuración SDD (strict_tdd: false)
- `openspec/changes/pipeline-procesamiento-whatsapp/state.yaml` — estado actual: exploring

### Pendientes SQL conocidos (de Notion — 05 Arquitectura Técnica)

Notion documenta 4 parches SQL pendientes que afectan este pipeline:

| Parche | Descripción | Bloquea |
|--------|-------------|---------|
| Parche 1 | `user_consents` — tabla de consentimientos | H0 legalmente (P6) |
| Parche 2 | `wa_message_costs` — tracking de costos WhatsApp | Medición de costos |
| Parche 3 | Índice NSM + vistas `v_nsm`, `v_nsm_global` | Métrica Norte |
| Parche 4 | `resolved_input_id` | H1 — NO ejecutar en H0 |

**Implicación directa:** El pipeline debe incluir inserción en `user_consents` (Parche 1) y en `wa_message_costs` (Parche 2). Estos no pueden omitirse.

---

## Hallazgos de Notion

Notion MCP disponible y consultado. Fuentes leídas:

- Manual Maestro v2.2 — Sección 7 (Arquitectura Funcional)
- Manual Maestro v2.2 — Sección 8 (Modelo de Datos)
- Manual Maestro v2.2 — Sección 9 (Flujos Operativos)
- Manual Maestro v2.2 — Sección 15 (Glosario de Campo)
- Flujos Conversacionales (04 — Diseño de Producto)
- Voz y Tono del Agente — Referencia Rápida
- 05 — Arquitectura Técnica (índice de docs)

### Hallazgos clave de Notion

1. **5 módulos funcionales definidos:** Canal de Ingesta → Agente IA (Extractor-Validador-Clasificador) → Base de Datos Estructurada → Motor de Reportes/Alertas → Control de Acceso por Rol. El pipeline cubre los primeros 3.

2. **Pipeline de voz con VAD explícito:** Notion define 4 etapas para audio: VAD (elimina segmentos de ruido puro para evitar alucinaciones en STT) → STT con vocabulario agrícola → Post-corrección LLM → Extracción estructurada. Esta es la arquitectura canónica.

3. **WER esperado 15-30%:** Incluso con modelos grandes. El post-procesamiento LLM es la capa crítica para cerrar la brecha de dominio.

4. **Tabla `mensajes_entrada` existe en el modelo de datos:** Es la tabla de ingesta que vincula mensajes WhatsApp con eventos generados. Clave para idempotencia y trazabilidad.

5. **Primer audio sin consentimiento:** Procesar como provisional → pedir consentimiento → si acepta: persistir; si no: borrar. Esta lógica debe estar en el flujo de onboarding, no en el pipeline principal.

6. **Flujo 5 (alertas proactivas) es H1:** Trigger por `risk_level = 'high'/'critical'` genera template message con costo. No implementar en H0 — solo estructurar el campo `severidad` en el schema.

---

## Análisis del pipeline

### Tipos de evento de campo

Fuente canónica: Manual Maestro v2.2, Sección 7.3 y tabla `eventos_campo` (Sección 8.5).

| Tipo (`tipo_evento`) | Ejemplos reales | Campos obligatorios | Campos opcionales |
|---------------------|----------------|--------------------|--------------------|
| `labor` | Chapeo, deshoje, enfunde, apuntalado | `lote_id`, `subtipo` (labor), `cantidad` (trabajadores), `unidad` (jornal/trato) | `area_afectada_ha`, nota |
| `insumo` | Fumigación urea, aplicación fungicida, herbicida | `lote_id`, `subtipo` (insumo/producto), `cantidad`, `unidad` (bombadas/litros/sacos) | `area_afectada_ha`, dosis exacta |
| `plaga` | Sigatoka, cochinilla, moniliasis, escoba, mazorca negra | `lote_id`, `subtipo` (tipo de plaga), `severidad` (leve/moderada/severa/crítica) | `area_afectada_ha`, imagen adjunta |
| `clima` | Lluvia, viento, inundación | `finca_id` o `lote_id`, `subtipo` (tipo de evento climático) | `intensidad`, duración |
| `cosecha` | Corte de racimos, pesaje cacao | `lote_id`, `cantidad`, `unidad` (cajas/quintales/kg) | `rechazo_%`, `brix` |
| `gasto` | Pago de jornales, compra insumos | `subtipo` (concepto), `cantidad` (monto), `unidad` (moneda) | `lote_id` |
| `observacion` | Cualquier observación no tipificada | `descripcion_raw` (texto libre) | clasificación IA automática |

**Notas importantes:**
- `lote_id` es obligatorio en todos los tipos excepto `clima` (puede ser finca) y `gasto` (puede ser sin lote).
- `descripcion_raw` siempre se persiste — es el input original sin procesar (P5: dato pertenece a la finca).
- El campo `datos_evento` (JSONB) almacena todo lo específico del tipo. La estructura varía.
- `finca_id` se infiere del usuario autenticado — no necesita extraerse del mensaje.

### JSONB `datos_evento` por tipo (estructura sugerida)

```json
// labor
{"labor_tipo": "chapeo", "num_trabajadores": 3, "modalidad": "jornal"}

// insumo
{"producto": "Mancozeb", "dosis_cantidad": 5, "dosis_unidad": "bombadas",
 "dosis_litros_equivalente": 100, "area_ha": 1.5}

// plaga
{"plaga_tipo": "Sigatoka", "severidad": "moderada", "area_afectada_ha": 0.8}

// clima
{"clima_tipo": "lluvia", "intensidad": "fuerte"}

// cosecha
{"cantidad": 20, "unidad": "qq", "kg_equivalente": 908,
 "rechazo_pct": 5, "brix": null}

// gasto
{"concepto": "jornales", "monto": 150, "moneda": "USD"}

// observacion
{"texto_libre": "...", "clasificacion_ia": "posible_plaga"}
```

### Estructura del webhook WhatsApp

El webhook de WhatsApp Business API (via 360Dialog o Wati) entrega payloads en formato Meta Cloud API:

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "...",
          "phone_number_id": "..."
        },
        "contacts": [{"profile": {"name": "..."}, "wa_id": "52XXXXXXXXXX"}],
        "messages": [{
          "id": "wamid.XXX",
          "from": "52XXXXXXXXXX",
          "timestamp": "1712345678",
          "type": "text|audio|image",

          // Si text:
          "text": {"body": "Apliqué 5 bombadas de Mancozeb en el lote 3"},

          // Si audio:
          "audio": {
            "id": "MEDIA_ID",
            "mime_type": "audio/ogg; codecs=opus",
            "sha256": "...",
            "voice": true
          },

          // Si image:
          "image": {
            "id": "MEDIA_ID",
            "mime_type": "image/jpeg",
            "sha256": "...",
            "caption": "texto opcional"
          }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**Puntos críticos del webhook:**
- La autenticación del usuario se hace por `from` (número de teléfono con código de país, sin `+`).
- Para audio/imagen, `MEDIA_ID` requiere una llamada adicional a la Graph API para obtener la URL de descarga temporal.
- Los webhooks deben responder HTTP 200 en <20s o Meta reintenta (configurable). Esto impacta el diseño del acuse de recibo.
- n8n debe verificar el `x-hub-signature-256` header para validar que el webhook es legítimo.

### Cadena STT → LLM → Extracción

#### Para mensajes de texto

```
Texto crudo del usuario
  → [n8n: Nodo "Autenticar usuario"]
     Lookup phone en tabla usuarios
     Si no existe → flujo onboarding (paralelo)
  → [n8n: Nodo "Verificar consentimiento"]
     Verificar consentimiento_datos = true en usuarios
     Si false → flujo solicitud consentimiento
  → [n8n: Nodo "Acuse de recibo"] ← DEBE ocurrir <5s
     Enviar "Estoy procesando tu reporte..." solo si el texto
     es inequívocamente un reporte (no saludo/consulta)
  → [n8n: Nodo "GPT-4o Mini — Extracción"]
     Input: texto + contexto usuario (finca, cultivo, lotes)
     Output: JSON con tipo_evento, campos extraídos, confidence_score
  → [n8n: Nodo "Validar completitud"]
     ¿Están los campos obligatorios para el tipo detectado?
     → Si completo → persistir
     → Si incompleto → clarificación (máx 2)
```

#### Para mensajes de audio (.opus)

```
Audio .opus de WhatsApp
  → [n8n: Nodo "Descargar media"]
     GET graph.facebook.com/v19.0/{media_id}
     → URL temporal de descarga
     GET {url} con Authorization header
     → Guardar en Supabase Storage o buffer temporal
  → [n8n: Nodo "Acuse inmediato"] ← SIEMPRE para audio (<5s)
     "Estoy procesando tu reporte..."
  → [n8n: Nodo "GPT-4o Mini Transcribe — STT"]
     Input: archivo .opus
     Output: transcripción texto
     Log: audio_ref, transcripción, modelo, latencia → LangFuse
  → [n8n: Nodo "GPT-4o Mini — Post-corrección STT"]
     Input: transcripción cruda + glosario agrícola
     Corrige: "la rolla" → "la roya", "helada" → moniliasis
     Output: texto corregido
     Log: input_raw, output_corregido, latencia → LangFuse
  → [n8n: Nodo "GPT-4o Mini — Extracción"] (igual que texto)
```

#### Para mensajes de imagen

```
Imagen JPEG/PNG con caption opcional
  → [n8n: Nodo "Descargar media"] (igual que audio)
  → [n8n: Nodo "Acuse inmediato"]
  → [n8n: Nodo "GPT-4o Mini Vision — Análisis imagen"]
     Input: imagen + caption + contexto finca/cultivo
     Output: descripción estructurada de lo observado
             (plaga visible, estado cultivo, cuantificación)
     Log → LangFuse
  → [n8n: Nodo "GPT-4o Mini — Extracción"] (igual que texto)
```

**Nota H0:** En H0 no hay VAD explícito (filtro de actividad de voz). GPT-4o Mini Transcribe maneja silencio/ruido razonablemente bien. VAD es optimización para H1 si WER resulta alto en H-TEC-02.

### Sesión conversacional y límite de clarificaciones

Este es el punto de diseño más crítico del pipeline, con 3 opciones:

#### Opción A: Estado en tabla Supabase `sesiones_activas` (recomendada)

```sql
CREATE TABLE sesiones_activas (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  finca_id TEXT,
  clarification_count INTEGER DEFAULT 0,  -- máx 2 (R2)
  contexto_parcial JSONB,                 -- extracción incompleta del turno anterior
  ultimo_mensaje_at TIMESTAMP,
  expires_at TIMESTAMP,                   -- TTL: 30 minutos de inactividad
  status TEXT DEFAULT 'active'            -- active | completed | fallback_nota_libre
);
```

**Ventajas:** Persistencia real, sobrevive reinicios de n8n, consultable para debugging.
**Desventaja:** Requiere GC periódico para limpiar sesiones expiradas.

#### Opción B: Estado en memoria de n8n (workflow variables)

n8n puede mantener estado en variables de workflow entre ejecuciones usando el nodo "Static Data" o Redis.

**Ventajas:** Sin tabla adicional, más simple.
**Desventaja:** Se pierde si n8n reinicia. No persistente. No auditable.

#### Opción C: Estado codificado en el mensaje de clarificación

Incluir un token serializado en el mensaje de Wasagro que el usuario devuelve. No viable — el usuario no maneja esto.

**Decisión sugerida:** Opción A. El estado de sesión en DB satisface R2 (contador explícito), es auditable, y sobrevive fallos de infraestructura. La tabla `sesiones_activas` es estructura de datos (H0-compatible según R5).

**Flujo del loop de clarificación:**

```
turno_1: usuario envía mensaje incompleto
  → extracción parcial → confidence_score para campos faltantes < 0.5
  → crear/actualizar sesion_activa: clarification_count = 1
  → preguntar campo faltante más crítico (UNA pregunta)

turno_2: usuario responde
  → merge con contexto_parcial de la sesión
  → re-extraer con contexto completo
  → si completo → persistir, cerrar sesión
  → si aún incompleto → clarification_count = 2 → segunda pregunta

turno_3: usuario responde (o no)
  → si completo → persistir
  → si incompleto → FALLBACK:
     persistir como tipo_evento='nota_libre', status='requires_review'
     mensaje: "Lo registro como nota y lo revisamos después."
     cerrar sesión
```

**Ventana de sesión:** 30 minutos. Si el usuario tarda más, la sesión expira y el siguiente mensaje empieza fresco. Esto evita contexto obsoleto de días anteriores.

### Logging LangFuse

Cada llamada que genera datos de campo debe tener una traza LangFuse. R4 de AGENTS.md es explícito: no puede existir un path donde un error se procese sin logging.

#### Estructura de traza por mensaje

```
Trace: "whatsapp_message_{message_id}"
  ├── Span: "autenticar_usuario" — latencia lookup
  ├── Span: "verificar_consentimiento"
  │
  ├── [Solo si audio] Span: "stt_transcripcion"
  │   ├── input: {audio_ref: "storage_url", duration_sec: N}
  │   ├── output: {transcripcion: "texto crudo..."}
  │   ├── model: "gpt-4o-mini-transcribe"
  │   ├── latency_ms: N
  │   └── cost_usd: N
  │
  ├── [Solo si audio] Span: "stt_post_correccion"
  │   ├── input: {raw: "texto crudo", glosario_ref: "v1.0"}
  │   ├── output: {corregido: "texto corregido"}
  │   ├── model: "gpt-4o-mini"
  │   └── latency_ms: N
  │
  ├── [Solo si imagen] Span: "vision_analisis"
  │   ├── input: {image_ref, caption}
  │   ├── output: {descripcion_estructurada}
  │   └── model: "gpt-4o-mini"  (con vision)
  │
  ├── Span: "llm_extraccion"
  │   ├── input: {texto_final, contexto_usuario: {finca, cultivo, lotes}}
  │   ├── output: {tipo_evento, campos_extraídos, confidence_score}
  │   ├── model: "gpt-4o-mini"
  │   ├── tokens_input: N
  │   ├── tokens_output: N
  │   ├── latency_ms: N
  │   └── cost_usd: N
  │
  ├── Span: "validar_completitud"
  │   ├── resultado: "completo" | "incompleto" | "fallback_nota_libre"
  │   └── campos_faltantes: [...]
  │
  └── Span: "persistir_evento"
      ├── evento_id: "UUID"
      ├── tipo_evento: "..."
      └── status: "ok" | "error"
```

**Score de evaluación a registrar:**
- `confidence_score`: 0-1, calculado por el LLM de extracción
- `completeness_score`: fracción de campos obligatorios presentes
- `requiere_validacion`: true si confidence_score < 0.5 en algún campo crítico

#### Campos para dataset de evaluación (LangFuse evals)

Para H-TEC-02 (validación STT con 20 audios reales), cada traza STT debe ser etiquetable con:
- `wer_score`: Word Error Rate calculado por revisor humano
- `domain_correction_needed`: si la post-corrección LLM fue necesaria
- `audio_quality`: `clear` | `noisy` | `partial_signal`

---

## Riesgos identificados

| Riesgo | Impacto | Mitigación sugerida |
|--------|---------|---------------------|
| **R-01** Latencia STT + LLM supera 30s para audios largos (>60s) | Alto — viola P3, usuario abandona | Implementar acuse inmediato al recibir audio antes de procesar. Truncar audios >90s con aviso al usuario. Timeout explícito en n8n con fallback a `nota_libre`. |
| **R-02** Webhook Meta no responde en <20s y Meta reintenta | Alto — duplicación de eventos | Diseño asíncrono: responder HTTP 200 inmediatamente en webhook, procesar en flujo paralelo. Usar `message_id` de WhatsApp como clave de idempotencia en `mensajes_entrada`. |
| **R-03** GPT-4o Mini inventa campo faltante (viola R1/P1) | Alto — dato agrícola incorrecto | El prompt de extracción debe instruir explícitamente: "Si no puedes extraer un campo, devuelve null. NUNCA asumas ni generes valores." Validar en post-procesamiento que `confidence_score < 0.5` para campos `null`. |
| **R-04** Usuario sin consentimiento envía datos útiles (P6) | Medio — dato provisional sin base legal | Flujo de onboarding paralelo al pipeline principal. Si `consentimiento_datos = false`: procesar como provisional en memoria, enviar solicitud de consentimiento, persistir solo si acepta. |
| **R-05** Estado de sesión corrupto o expirado con contexto incorrecto | Medio — extracción incorrecta en turno 2 | TTL de 30 min en sesiones_activas. Si sesión expirada: tratar mensaje como nuevo, no como continuación. |
| **R-06** Audio con ruido severo → STT genera texto sin sentido → LLM extrae basura con confidence alto | Alto — dato inválido persistido | Agregar validación semántica post-extracción: si `confidence_score < 0.3` O si campos críticos son todos `null` → no persistir como evento tipificado, ir directo a `nota_libre`. |
| **R-07** `lote_id` ambiguo (usuario dice "el lote de arriba") | Medio — campo obligatorio no extraíble | Si usuario tiene <3 lotes: preguntar directamente. Si tiene >3 lotes: listar opciones en la pregunta de clarificación. |
| **R-08** WER > 25% en H-TEC-02 invalida GPT-4o Mini Transcribe (D4) | Alto — decisión D4 a revisar | No bloquea H0 si se diseña el pipeline con interfaz STT intercambiable. Parametrizar el modelo STT como variable de configuración. |
| **R-09** LangFuse self-hosted en Postgres compartido satura la DB | Bajo en H0 (<5 fincas piloto) | Monitorear volumen de traces. En H1 migrar a LangFuse Cloud si >50K traces/mes. |
| **R-10** n8n añade >5s de latencia en cadena de nodos | Medio — puede sumarse al presupuesto de 30s | Medir latencia de n8n por nodo en primeras pruebas. Si supera 5s, evaluar Inngest. |

---

## Preguntas abiertas

1. **¿Cómo se resuelve `lote_id` desde el mensaje?** El usuario rara vez dice el código del lote (F001-L03). Dice "el lote de arriba" o "el lote 3". ¿El sistema tiene un mapping nombre→lote_id por finca? ¿O el LLM debe resolver la ambigüedad con contexto? Necesita decisión de producto/data model.

2. **¿Qué pasa cuando el usuario menciona un lote que no existe en la DB?** ¿Preguntar si quiere crearlo? ¿O persistir con `lote_id = null` y `requiere_validacion = true`? Esto toca R1 (no inventar) pero también UX.

3. **¿El acuse de recibo inmediato ("Estoy procesando...") siempre se envía o solo para audios?** Notion dice "Si el pipeline tarda más [de 5s]" — pero el pipeline siempre tardará más de 5s para texto también. ¿Se envía acuse para todo mensaje que llegue a extracción LLM?

4. **¿Cómo se maneja una imagen SIN caption?** El usuario manda foto de una plaga sin escribir nada. El pipeline de visión puede intentar clasificar, pero el tipo de evento y el lote son desconocidos. ¿Va directo a clarificación? ¿O directo a `nota_libre`?

5. **¿La tabla `sesiones_activas` forma parte del schema H0 o es una adición?** El schema canónico en Notion (Sección 8) no la incluye. Necesita confirmación si es scope H0 o si el estado de sesión se maneja en otra capa.

6. **¿El BSP es 360Dialog o Wati?** CLAUDE.md dice "360Dialog o Wati" (D6 no está definido). La estructura del webhook y el método de descarga de media difieren entre BSPs. Necesita decisión antes de implementar el nodo de descarga de audio.

7. **¿Qué contexto de finca se inyecta al LLM de extracción?** Para que el LLM resuelva "lote 3" al `lote_id` correcto, necesita la lista de lotes de la finca. ¿Cuántos lotes puede tener una finca? ¿El prompt incluye todos los lotes o solo los activos?

8. **¿LangFuse self-hosted ya está desplegado?** Las parches SQL de Notion incluyen tablas pero no mencionan despliegue de LangFuse. ¿Está corriendo? ¿Comparte el mismo Postgres de Supabase o es instancia separada?

---

## Recomendación de arquitectura

### Dónde vive el estado

- **Estado de sesión conversacional:** Tabla `sesiones_activas` en Supabase. Es estructura de datos (H0-compatible), auditable, y sobrevive reinicios de n8n.
- **Contexto de extracción parcial:** JSONB `contexto_parcial` en `sesiones_activas`. No en memoria de n8n.
- **Mensajes de entrada:** Tabla `mensajes_entrada` — ya definida en Notion/Sección 8.6. Es la fuente de idempotencia.

### Cómo estructurar los flujos n8n

Un flujo por caso de uso (convención CLAUDE.md). Se proponen 4 flujos para H0:

| Flujo | Descripción | Trigger |
|-------|-------------|---------|
| `flujo-01-recibir-mensaje` | Webhook → autenticar → enrutar por tipo (texto/audio/imagen/consulta) | Webhook WhatsApp |
| `flujo-02-procesar-reporte` | STT (si aplica) → extracción LLM → clarificación → persistir → confirmar | Sub-flujo desde flujo-01 |
| `flujo-03-onboarding` | Detectar nuevo usuario → consentimiento → registro → bienvenida | Sub-flujo desde flujo-01 |
| `flujo-04-reporte-semanal` | Agrupar eventos → resumen IA → enviar al gerente | Cron lunes 6 AM |

### Dónde va el schema SQL

El pipeline requiere las siguientes tablas/parches en este orden de prioridad:

1. `user_consents` (Parche 1) — **bloqueante legal para H0**
2. `sesiones_activas` — **bloqueante operativo** para el loop de clarificación
3. `mensajes_entrada` — ya diseñada en Notion, necesita implementación
4. `eventos_campo` + `lotes` + `usuarios` + `fincas` — schema core
5. `wa_message_costs` (Parche 2) — importante para medición, no bloqueante inicial

### Interfaz de herramientas intercambiables

El pipeline debe parametrizar:
- **Modelo STT:** Variable de configuración, no hardcodeado. Facilita migración si H-TEC-02 invalida GPT-4o Mini Transcribe.
- **Modelo LLM extracción:** Siempre GPT-4o Mini en H0 (D3). Si un evento requiere GPT-4o, loggear razón en engram (R5/D3 en CLAUDE.md).
- **BSP WhatsApp:** Abstraer la capa de envío de mensajes para soportar 360Dialog y Wati sin cambio de lógica de negocio.

### Restricciones de H0 para el diseño

Según R5 (AGENTS.md), el pipeline H0 puede incluir:
- Schema completo con campos de H1/H2 como columnas opcionales — PERMITIDO
- Lógica del flujo principal (texto/audio/imagen → evento) — PERMITIDO
- Lógica de alertas proactivas por `risk_level` (Flujo 5 de Notion) — PROHIBIDO (H1)
- Router de modelos LLM por complejidad — PROHIBIDO (H1)
- Dashboard web endpoint — PROHIBIDO (H2)

---

## Apéndice: Referencia de campos por tipo de evento

### Extracción mínima viable para cumplir R1/R2

Para cada `tipo_evento`, estos son los campos cuya ausencia dispara una pregunta de clarificación:

| Tipo | Campo crítico #1 | Campo crítico #2 | Tolerado como null |
|------|-----------------|------------------|--------------------|
| `labor` | `lote_id` | `subtipo` (labor) | num_trabajadores → preguntar solo si ambiguo |
| `insumo` | `lote_id` | `subtipo` (producto) | dosis → preguntar si no viene |
| `plaga` | `lote_id` | `subtipo` (tipo plaga) | severidad → defaultear a "moderada" con `confidence_score=0.4` |
| `clima` | `subtipo` | — | lote_id → puede ser finca |
| `cosecha` | `lote_id` | `cantidad` + `unidad` | rechazo_pct, brix → null ok |
| `gasto` | `subtipo` (concepto) | `cantidad` | lote_id → null ok |
| `observacion` | `descripcion_raw` | — | todo lo demás → null |

**Regla de prioridad de clarificación:** Preguntar primero por `lote_id` si falta (es el campo más frecuentemente omitido). Luego por el dato de cantidad/producto específico del tipo.
