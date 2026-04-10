# Propuesta: pipeline-procesamiento-whatsapp

> Fase: sdd-propose | Fecha: 2026-04-09 | Estado: completo

---

## Objetivo

Construir el pipeline completo de procesamiento de mensajes WhatsApp que convierte inputs crudos (texto, audio `.opus`, imagen) en eventos de campo estructurados persistidos en Supabase. Este pipeline es el nucleo operativo de Wasagro en H0: sin el, no hay captura de datos de campo. El exito se mide por la capacidad de recibir un mensaje WhatsApp de un agricultor y producir un `eventos_campo` estructurado con latencia total <30s, acuse <5s, maximo 2 clarificaciones, y logging completo en LangFuse.

**Metrica Norte H0:** Eventos de campo completos por semana por finca activa.

---

## Alcance H0

### Incluido

- **Schema SQL completo** para H0: `user_consents`, `sesiones_activas`, `mensajes_entrada`, schema core (`usuarios`, `fincas`, `lotes`, `eventos_campo`), `wa_message_costs`
- **flujo-01-recibir-mensaje**: Webhook Meta Cloud API -> autenticar -> enrutar por tipo/estado del usuario
- **flujo-02-procesar-reporte**: STT (audio) / Vision (imagen) -> post-correccion -> extraccion LLM -> validacion -> clarificacion (max 2) -> persistencia
- **flujo-03-onboarding**: Encuesta conversacional bloqueante que construye perfil completo de finca antes de habilitar reportes (D10)
- **flujo-04-reporte-semanal**: Cron -> agregacion eventos -> resumen IA -> envio a gerente de finca
- **Sistema de prompts**: System prompts para extraccion, post-correccion STT, vision, onboarding, y reporte semanal
- **Logging LangFuse**: Trazas completas por mensaje con spans por cada llamada LLM/STT (R4)
- **Sesiones conversacionales**: Tabla `sesiones_activas` con TTL 30 min y contador de clarificaciones (R2)
- **Idempotencia**: `wamid` de WhatsApp como clave de deduplicacion en `mensajes_entrada`
- **Resolucion de lote_id por LLM**: Lista de lotes activos inyectada en system prompt de extraccion (D7)
- **Acuse de recibo**: Template WhatsApp antes del pipeline LLM para todo mensaje que entra a extraccion (D8)

### Excluido (explicitamente)

- **VAD (Voice Activity Detection)**: GPT-4o Mini Transcribe maneja ruido en H0. Optimizacion H1.
- **Router de modelos LLM**: Solo GPT-4o Mini, siempre. Si un evento requiere GPT-4o, loggear razon en engram (D3/R5).
- **Alertas proactivas por risk_level**: Flujo 5 de Notion. Solo se estructura el campo `severidad` en schema. Logica es H1.
- **Dashboard web**: H2.
- **Tabla de alias de lotes**: Resolucion semantica por LLM en H0 (D7). Tabla de alias es H1.
- **Parche `resolved_input_id`**: Notion Parche 4. Explicitamente H1.
- **Multi-idioma**: Solo espanol LATAM (Ecuador/Guatemala) en H0.
- **Procesamiento de video**: Solo texto, audio .opus, imagen JPEG/PNG.

---

## Arquitectura propuesta

### Componentes

| Componente | Responsabilidad | Tecnologia | Notas |
|---|---|---|---|
| Webhook receiver | Recibir mensajes WhatsApp, validar firma, responder HTTP 200 inmediato | n8n (flujo-01) | Valida `x-hub-signature-256`. Responde HTTP 200 antes de procesar (R-02). |
| Router de mensajes | Clasificar tipo de mensaje y estado del usuario, enrutar al flujo correcto | n8n (flujo-01) | Bifurca: usuario nuevo -> onboarding, usuario sin consentimiento -> solicitar, reporte -> flujo-02 |
| Pipeline STT | Transcribir audio .opus a texto | GPT-4o Mini Transcribe via API | Modelo parametrizado como variable n8n. Facilita migracion si H-TEC-02 invalida (R-08). |
| Post-correccion STT | Corregir jerga agricola en transcripcion | GPT-4o Mini | "la rolla" -> "la roya", "helada" -> moniliasis. Glosario en system prompt. |
| Pipeline Vision | Analizar imagen con caption opcional | GPT-4o Mini (vision) | Descripcion estructurada: plaga visible, estado cultivo, cuantificacion. |
| Motor de extraccion | Convertir texto (crudo o procesado) a JSON estructurado | GPT-4o Mini | System prompt con contexto de finca/lotes del usuario. Output: tipo_evento + campos + confidence_score. |
| Validador de completitud | Verificar campos obligatorios por tipo_evento | n8n (logica condicional) | Campos faltantes -> clarificacion o nota_libre segun contador de sesion. |
| Gestor de sesiones | Mantener estado conversacional entre turnos | Supabase (`sesiones_activas`) | TTL 30 min. Max 2 clarificaciones (R2). Contexto parcial en JSONB. |
| Persistencia | Insertar eventos validados en DB | Supabase (`eventos_campo` + `mensajes_entrada`) | RLS por finca (P5). `descripcion_raw` siempre persistido. |
| Acuse de recibo | Enviar "Estoy procesando tu reporte..." antes del pipeline | n8n -> Meta Cloud API | Template simple, no respuesta LLM (D8). |
| Onboarding | Encuesta conversacional para perfil de finca | n8n (flujo-03) | Bloqueante: sin onboarding completo, no se aceptan reportes (D10). |
| Reporte semanal | Agregar eventos y generar resumen | n8n (flujo-04) + GPT-4o Mini | Cron lunes 6 AM. Resumen para gerente de finca. |
| Observabilidad | Logging de cada llamada LLM/STT | LangFuse self-hosted | Traza por mensaje con spans por operacion. Scores de evaluacion. (R4) |
| Tracking de costos | Registrar costo por mensaje WhatsApp | Supabase (`wa_message_costs`) | Mensajes user-initiated en ventana 24h = $0 (D6). |

### 4 flujos n8n

---

#### flujo-01-recibir-mensaje

**Trigger:** Webhook HTTP (Meta Cloud API envia POST con payload de mensaje)

**Nodos:**

1. **"Webhook WhatsApp"** — Recibe POST de Meta. Responde HTTP 200 inmediatamente (antes de cualquier procesamiento). Esto evita reintentos de Meta (R-02).

2. **"Validar firma"** — Verifica `x-hub-signature-256` contra el app secret. Si invalido: loggear intento y descartar. No procesar payloads no autenticados.

3. **"Extraer mensaje"** — Parsea el payload Meta Cloud API: extrae `message_id` (wamid), `from` (telefono), `type` (text/audio/image), `timestamp`, y el contenido segun tipo.

4. **"Verificar idempotencia"** — SELECT en `mensajes_entrada` por `wa_message_id`. Si ya existe: descartar (mensaje duplicado). Si no existe: INSERT con `status='received'`.

5. **"Buscar usuario"** — SELECT en `usuarios` por `phone`. Determina si el usuario existe y tiene onboarding completo.

6. **"Switch: Estado del usuario"** — Bifurcacion:
   - Usuario no existe -> **flujo-03-onboarding** (primer contacto)
   - Usuario existe, `onboarding_completo = false` -> **flujo-03-onboarding** (continuar)
   - Usuario existe, `consentimiento_datos = false` -> Enviar solicitud de consentimiento
   - Usuario existe, onboarding completo, consentimiento OK -> continuar a paso 7

7. **"Switch: Tipo de mensaje"** — Bifurcacion por `type`:
   - `text` -> evaluar si es saludo/consulta simple (heuristicas basicas: "hola", "gracias", "?") o reporte
   - `audio` -> siempre a flujo-02
   - `image` -> siempre a flujo-02
   - Saludos/consultas simples -> respuesta directa sin pipeline LLM (no acuse, no extraccion)

8. **"Enviar acuse de recibo"** (D8) — Para todo mensaje que va a flujo-02: enviar via Meta Cloud API "Estoy procesando tu reporte..." Debe ocurrir en <5s desde recepcion (P3).

9. **"Disparar flujo-02"** — Ejecutar flujo-02-procesar-reporte pasando: `mensaje_id`, `phone`, `finca_id`, `tipo_mensaje`, `contenido_raw`, `usuario_context` (finca, cultivo, lotes).

**Manejo de errores:**
- Error en webhook/firma: loggear en LangFuse, no responder al usuario.
- Error en lookup de usuario: loggear, responder "Hubo un problema, intenta de nuevo en unos minutos."
- Timeout general del flujo: 15s maximo antes de que el acuse salga.

---

#### flujo-02-procesar-reporte

**Trigger:** Sub-flujo llamado desde flujo-01 con contexto del mensaje.

**Nodos:**

1. **"Iniciar traza LangFuse"** — Crear trace `whatsapp_message_{message_id}` con metadata: phone, finca_id, tipo_mensaje.

2. **"Buscar sesion activa"** — SELECT en `sesiones_activas` por `phone` WHERE `status='active'` AND `expires_at > NOW()`.
   - Si existe: este es un turno de continuacion (respuesta a clarificacion). Cargar `contexto_parcial`.
   - Si no existe: mensaje nuevo, sesion fresh.

3. **"Switch: Tipo de contenido"** — Bifurcacion:

   **Rama audio:**
   - 3a. **"Descargar media"** — GET `graph.facebook.com/v21.0/{media_id}` con token -> obtener URL temporal -> GET URL -> buffer binario. Span LangFuse: `descargar_media`.
   - 3b. **"STT Transcripcion"** — Llamada a GPT-4o Mini Transcribe con buffer .opus. Output: texto crudo. Span LangFuse: `stt_transcripcion` con input (audio_ref, duration_sec), output (transcripcion), model, latency_ms, cost_usd.
   - 3c. **"Post-correccion STT"** — GPT-4o Mini con system prompt de glosario agricola. Corrige jerga. Span LangFuse: `stt_post_correccion`. Output: texto corregido.

   **Rama imagen:**
   - 3d. **"Descargar media"** — Igual que audio.
   - 3e. **"Vision Analisis"** — GPT-4o Mini con vision. Input: imagen + caption (si existe) + contexto finca/cultivo. Output: descripcion estructurada (plaga visible, estado, cuantificacion). Span LangFuse: `vision_analisis`.

   **Rama texto:**
   - Texto directo del usuario, sin procesamiento previo.

4. **"Preparar texto final"** — Merge: si habia sesion activa, concatenar `contexto_parcial.texto_previo` con el texto nuevo. Si audio: usar texto post-corregido. Si imagen: usar descripcion de vision + caption. Si texto: usar texto crudo.

5. **"LLM Extraccion"** — GPT-4o Mini con system prompt de extraccion. Input: texto_final + contexto_usuario (finca_id, cultivo_principal, lista de lotes con nombre coloquial y codigo). Output JSON: `tipo_evento`, campos extraidos por tipo, `confidence_score` por campo. Span LangFuse: `llm_extraccion` con tokens_input, tokens_output, latency_ms, cost_usd. **El prompt instruye explicitamente: "Si no puedes extraer un campo, devuelve null con confidence_score < 0.5. NUNCA asumas ni generes valores." (R1/P1)**

6. **"Validar completitud"** — Logica condicional que verifica campos obligatorios segun `tipo_evento` (ver tabla de campos criticos en exploracion). Span LangFuse: `validar_completitud`.
   - **Completo** (todos los campos criticos presentes con confidence >= 0.5): -> paso 8
   - **Incompleto**: -> paso 7

7. **"Gestion de clarificacion"** — Evaluar estado de sesion:
   - Si `clarification_count < 2`: incrementar contador, guardar extraccion parcial en `contexto_parcial`, formular pregunta de clarificacion (prioridad: lote_id primero, luego dato de cantidad/producto), enviar pregunta via Meta Cloud API. FIN del flujo (espera siguiente mensaje).
   - Si `clarification_count >= 2`: **FALLBACK** -> persistir como `tipo_evento='nota_libre'`, `status='requires_review'`. Mensaje al usuario: "Lo registro como nota y lo revisamos despues." Cerrar sesion. -> paso 8

8. **"Persistir evento"** — INSERT en `eventos_campo` con todos los campos extraidos. `descripcion_raw` = input original sin procesar (P5). INSERT/UPDATE en `mensajes_entrada` con `status='processed'`, `evento_id` vinculado. Span LangFuse: `persistir_evento`.

9. **"Registrar costo WhatsApp"** — INSERT en `wa_message_costs` con tipo de mensaje, direccion, costo estimado ($0 para user-initiated en ventana 24h por D6).

10. **"Confirmar al usuario"** — Enviar confirmacion breve via Meta Cloud API. Ejemplo: "Listo, registre [tipo_evento] en [lote]. [emoji]". Maximo 3 lineas, tuteo, sin vocabulario prohibido.

11. **"Cerrar traza LangFuse"** — Registrar scores finales: `confidence_score`, `completeness_score`, `requiere_validacion`. Cerrar trace.

**Manejo de errores:**
- Error en STT: loggear en LangFuse con audio_ref, responder "No pude procesar el audio, podrias enviarlo de nuevo o escribirlo como texto?"
- Error en LLM: loggear input/output/error en LangFuse, persistir como `nota_libre` con `status='requires_review'`.
- Timeout (>30s): si el acuse ya salio, continuar procesando. Si no salio, enviar acuse inmediato. Nunca dejar mensaje sin respuesta.
- **No existe catch vacio ni error silencioso** (R4). Todo path de error tiene logging LangFuse explicito.

---

#### flujo-03-onboarding

**Trigger:** Sub-flujo llamado desde flujo-01 cuando el usuario no tiene onboarding completo.

**Concepto (D10):** Encuesta conversacional bloqueante. Antes de que un usuario pueda enviar reportes, debe completar su perfil de finca. Esto elimina el riesgo de "lote desconocido" porque el sistema ya tiene la lista completa de lotes.

**Nodos:**

1. **"Verificar estado onboarding"** — SELECT en `usuarios` + `sesiones_activas` WHERE `tipo_sesion='onboarding'`. Determinar en que paso esta el usuario.

2. **"Switch: Paso actual"** — Bifurcacion segun estado del onboarding:

   **Paso 1 — Primer contacto:**
   - Saludo de bienvenida + solicitud de nombre y rol
   - Crear registro en `usuarios` con `phone`, `onboarding_completo=false`
   - Crear sesion activa tipo `onboarding`

   **Paso 2 — Consentimiento (P6):**
   - Enviar texto exacto del consentimiento (almacenado en template)
   - Esperar respuesta afirmativa
   - Si acepta: INSERT en `user_consents` con timestamp, tipo, texto mostrado
   - Si rechaza: explicar que no se pueden capturar datos, cerrar. No persistir datos provisionales.
   - **Si el primer mensaje ya contenia datos utiles:** procesado como provisional en memoria, ahora persistir si acepto, borrar si rechazo.

   **Paso 3 — Datos de finca:**
   - Preguntar nombre de finca, ubicacion general (departamento/provincia), cultivo principal
   - INSERT en `fincas` con `finca_id` generado (formato F001)

   **Paso 4 — Lista de lotes:**
   - Preguntar: "Cuantos lotes tenes y como les decis? Por ejemplo: lote de arriba, lote 3, el de la quebrada..."
   - Parsear la respuesta (puede ser un solo mensaje con multiples lotes o multiples mensajes)
   - Por cada lote: INSERT en `lotes` con `lote_id` (F001-L01), `nombre_coloquial`, `hectareas` (si lo menciona, sino null)
   - Confirmar lista al usuario: "Entonces tenes: [lote1], [lote2], [lote3]. Esta bien?"

   **Paso 5 — Confirmar y activar:**
   - UPDATE `usuarios` SET `onboarding_completo=true`, `finca_id`
   - Mensaje: "Listo, ya podes enviar tus reportes de campo. Solo mandame un mensaje con lo que paso en la finca."
   - Cerrar sesion de onboarding.

3. **"Logging LangFuse"** — Traza `onboarding_{phone}` con span por cada paso. Solo se loggean llamadas LLM si se usan (parseo de lotes).

**Manejo de errores:**
- Si el usuario abandona mid-onboarding: sesion expira en 30 min. Al volver, retoma desde el ultimo paso completado.
- Max 2 clarificaciones por paso individual. Si no se completa un paso tras 2 intentos: registrar lo que se tiene, marcar `onboarding_completo=false`, informar que puede continuar despues.

---

#### flujo-04-reporte-semanal

**Trigger:** Cron — Lunes 6:00 AM (hora local Ecuador/Guatemala).

**Nodos:**

1. **"Obtener fincas activas"** — SELECT fincas con al menos 1 evento en los ultimos 7 dias.

2. **"Agregar eventos por finca"** — Por cada finca activa: SELECT eventos_campo de la semana, agrupar por tipo_evento y lote_id. Calcular conteos, totales.

3. **"Generar resumen IA"** — GPT-4o Mini con system prompt de resumen. Input: datos agregados + contexto de finca. Output: resumen en lenguaje natural (max 10 lineas), destacando: actividades principales, plagas reportadas, observaciones pendientes de revision. Span LangFuse: `reporte_semanal_{finca_id}`.

4. **"Enviar a gerente"** — Obtener telefono del usuario con rol `gerente` o `propietario` de la finca. Enviar resumen via Meta Cloud API. **Nota:** Si esta fuera de ventana 24h, requiere template aprobado por Meta.

5. **"Registrar envio"** — INSERT en `wa_message_costs` con tipo=template, costo estimado.

**Manejo de errores:**
- Si no hay eventos en la semana: no enviar reporte vacio. Registrar "sin actividad" en log.
- Error en LLM de resumen: enviar datos tabulares sin resumen IA.
- Error en envio WhatsApp: retry x3 con backoff exponencial. Si falla: loggear, no escalar (H0).

---

### Schema SQL (nuevas tablas)

El schema se divide en migraciones numeradas siguiendo la convencion del repo (`XX-patch-nombre.sql`) y el orden de prioridad confirmado:

#### Archivo `backend/sql/01-schema-core.sql` — Schema base

Tablas core que ya estan definidas en Notion Seccion 8 pero no implementadas:

| Tabla | Descripcion | PK | Notas |
|---|---|---|---|
| `usuarios` | Usuarios del sistema (agricultores, gerentes) | `id` UUID | `phone` TEXT UNIQUE, `finca_id` TEXT FK, `rol`, `onboarding_completo` BOOLEAN |
| `fincas` | Fincas de exportacion | `finca_id` TEXT (F001) | `nombre`, `ubicacion`, `cultivo_principal`, `coordenadas` POINT, `poligono` POLYGON |
| `lotes` | Lotes dentro de una finca | `lote_id` TEXT (F001-L01) | `finca_id` FK, `nombre_coloquial`, `hectareas`, `cultivo` |
| `eventos_campo` | Eventos estructurados de campo | `id` UUID | `finca_id` FK, `lote_id` FK (nullable), `tipo_evento`, `datos_evento` JSONB, `confidence_score`, `descripcion_raw`, `status`, `created_by` FK |

RLS habilitado en todas las tablas, con politicas por `finca_id` (P5).

#### Archivo `backend/sql/02-patch-user-consents.sql` — Bloqueante legal (P6)

| Tabla | Descripcion |
|---|---|
| `user_consents` | Consentimientos documentados: `id` UUID, `user_id` FK, `phone` TEXT, `tipo` TEXT (datos/comunicaciones), `texto_mostrado` TEXT, `aceptado` BOOLEAN, `timestamp` TIMESTAMPTZ |

**Prioridad 1 — Sin esta tabla, no se puede capturar ningun dato legalmente.**

#### Archivo `backend/sql/03-patch-sesiones-activas.sql` — Bloqueante operativo

| Tabla | Descripcion |
|---|---|
| `sesiones_activas` | Estado de sesion conversacional: `session_id` UUID PK, `phone` TEXT, `finca_id` TEXT, `tipo_sesion` TEXT (reporte/onboarding), `clarification_count` INTEGER DEFAULT 0, `contexto_parcial` JSONB, `ultimo_mensaje_at` TIMESTAMPTZ, `expires_at` TIMESTAMPTZ, `status` TEXT DEFAULT 'active' |

TTL de 30 min implementado como `expires_at = NOW() + INTERVAL '30 minutes'`. GC: consultas filtran por `expires_at > NOW()`. Limpieza periodica opcional (cron en n8n o pg_cron).

#### Archivo `backend/sql/04-patch-mensajes-entrada.sql` — Idempotencia

| Tabla | Descripcion |
|---|---|
| `mensajes_entrada` | Log de mensajes entrantes: `id` UUID, `wa_message_id` TEXT UNIQUE (wamid para idempotencia), `phone` TEXT, `tipo_mensaje` TEXT (text/audio/image), `contenido_raw` TEXT, `media_ref` TEXT (URL de storage si audio/imagen), `evento_id` UUID FK (nullable, vincula al evento generado), `status` TEXT (received/processing/processed/error), `created_at` TIMESTAMPTZ |

**El UNIQUE en `wa_message_id` es la clave de idempotencia contra reintentos de Meta.**

#### Archivo `backend/sql/05-patch-wa-message-costs.sql` — Tracking de costos

| Tabla | Descripcion |
|---|---|
| `wa_message_costs` | Tracking de costos WhatsApp: `id` UUID, `finca_id` TEXT, `direction` TEXT (inbound/outbound), `message_type` TEXT (text/audio/image/template), `cost_usd` NUMERIC, `created_at` TIMESTAMPTZ |

#### Archivo `backend/sql/06-patch-indices-nsm.sql` — Metrica Norte

Indice NSM + vistas `v_nsm` (por finca) y `v_nsm_global`. Corresponde a Notion Parche 3.

---

### Sistema de prompts

Todos los prompts viven en `prompts/` con nomenclatura descriptiva. Siguen las reglas de Voz y Tono de Notion: tuteo Ecuador/Guatemala, max 3 lineas en respuestas al usuario, emojis solo checkmark/warning, vocabulario prohibido excluido.

| Prompt | Archivo | Contexto inyectado | Output esperado |
|---|---|---|---|
| Extraccion de eventos | `prompts/extraccion-evento.md` | System: tipos de evento, campos por tipo, reglas R1 (nunca inventar), lista de lotes de la finca del usuario (D7). User: texto del mensaje. | JSON: `{tipo_evento, campos, confidence_score_por_campo}` |
| Post-correccion STT | `prompts/post-correccion-stt.md` | System: glosario de campo (bombada, caneca, quintal, escoba, helada, etc.), cultivos comunes, instruccion de corregir sin alterar significado. User: transcripcion cruda. | Texto corregido |
| Analisis de imagen | `prompts/analisis-imagen.md` | System: tipos de plaga por cultivo, escala de severidad, instruccion de describir solo lo observable (R1). User: imagen + caption. | Descripcion estructurada JSON |
| Pregunta de clarificacion | `prompts/clarificacion.md` | System: campo faltante, contexto parcial, reglas de tono. | Pregunta natural en max 2 lineas |
| Resumen semanal | `prompts/resumen-semanal.md` | System: datos agregados de la semana, contexto de finca. | Resumen en lenguaje natural, max 10 lineas |
| Onboarding | `prompts/onboarding.md` | System: paso actual del onboarding, datos ya recopilados. | Siguiente pregunta o confirmacion |

**Detalle del prompt de extraccion (el mas critico):**

El system prompt de extraccion incluye:
1. Lista de `tipo_evento` validos con sus campos obligatorios y opcionales
2. Regla explicita: "Si no puedes determinar un campo, devuelve `null` con `confidence: 0.0`. NUNCA inventes un valor." (R1/P1)
3. Lista de lotes activos de la finca del usuario con `lote_id` y `nombre_coloquial` (D7) — inyectada dinamicamente por n8n
4. Glosario de unidades de campo (bombada=20L, quintal=45.4kg, etc.)
5. Formato de output JSON estricto con schema definido
6. Instruccion de clasificar como `observacion` si no puede determinar el tipo con confianza

---

### Logging LangFuse

Estructura de trazas siguiendo R4 (todo error se loggea sin excepcion):

**Traza por mensaje:** `whatsapp_message_{wa_message_id}`

| Span | Cuando | Inputs loggeados | Outputs loggeados | Metricas |
|---|---|---|---|---|
| `autenticar_usuario` | Siempre | phone | user_id, finca_id, onboarding_status | latency_ms |
| `descargar_media` | Audio/imagen | media_id, mime_type | storage_ref, file_size_bytes | latency_ms |
| `stt_transcripcion` | Audio | audio_ref, duration_sec | transcripcion_cruda | model, latency_ms, cost_usd |
| `stt_post_correccion` | Audio | transcripcion_cruda, glosario_version | texto_corregido | model, latency_ms, tokens_in, tokens_out |
| `vision_analisis` | Imagen | image_ref, caption | descripcion_estructurada | model, latency_ms, tokens_in, tokens_out |
| `llm_extraccion` | Siempre (en flujo-02) | texto_final, contexto_usuario | tipo_evento, campos, confidence_scores | model, latency_ms, tokens_in, tokens_out, cost_usd |
| `validar_completitud` | Siempre (en flujo-02) | campos_extraidos, tipo_evento | resultado (completo/incompleto/fallback), campos_faltantes | — |
| `persistir_evento` | Si validacion pasa | evento completo | evento_id, status | — |

**Scores registrados por traza:**
- `confidence_score`: 0-1, del LLM de extraccion (score global del evento)
- `completeness_score`: fraccion de campos obligatorios presentes (0-1)
- `requiere_validacion`: boolean, true si confidence_score < 0.5 en algun campo critico

**Para H-TEC-02 (evaluacion STT)**, cada traza STT es etiquetable con:
- `wer_score`: Word Error Rate por revisor humano
- `domain_correction_needed`: si post-correccion fue necesaria
- `audio_quality`: clear | noisy | partial_signal

**Regla critica:** No existe un path de ejecucion donde un error se procese sin logging. Todo `catch` tiene `langfuse.span({ level: 'ERROR', ... })`. No hay catch vacios (R4).

---

## Decisiones de arquitectura

| # | Decision | Opcion elegida | Alternativa descartada | Justificacion |
|---|---|---|---|---|
| DA-01 | Estado de sesion conversacional | Tabla `sesiones_activas` en Supabase | Memoria n8n (workflow variables) / Redis | Persistencia real, sobrevive reinicios de n8n, auditable, consultable para debugging. n8n memory se pierde en restart. Redis aniade componente innecesario en H0. Cumple R2 con contador explicito. |
| DA-02 | Idempotencia de mensajes | `wa_message_id` UNIQUE en `mensajes_entrada` | Deduplicacion en memoria n8n | Meta reintenta webhooks si no recibe HTTP 200 en <20s (R-02). La deduplicacion debe ser persistente y atomica. UNIQUE constraint en Postgres es la solucion mas robusta. |
| DA-03 | Acuse de recibo | Template estatico via Meta API antes de pipeline LLM | Respuesta LLM rapida / Sin acuse | D8 confirmado. El acuse no es inteligente: es un template fijo. Esto garantiza <5s (P3) sin depender de latencia LLM. Se omite solo para saludos/consultas simples que no entran a extraccion. |
| DA-04 | Resolucion de lote_id | LLM con lista de lotes en system prompt | Tabla de alias / Fuzzy match en SQL | D7 confirmado. El LLM resuelve "el lote de arriba" semanticamente contra la lista conocida. Mas flexible que matching exacto. Sin tabla adicional en H0. |
| DA-05 | Onboarding como gate | Encuesta bloqueante antes de habilitar reportes | Onboarding lazy (pedir datos cuando falten) | D10 confirmado. Elimina el riesgo de "lote desconocido" porque el sistema tiene la lista completa ANTES de recibir el primer reporte. Mejor UX que interrumpir reportes con preguntas de perfil. |
| DA-06 | BSP WhatsApp | Meta Cloud API directo | Wati / 360Dialog | D6 confirmado. Sin intermediario en H0. phone_number_id y WABA_ID portables a H1. User-initiated messages = $0 en ventana 24h. |
| DA-07 | Modelo LLM unico | GPT-4o Mini para todo | Router de complejidad (GPT-4o para casos dificiles) | D3/R5 confirmado. Un solo modelo simplifica logging, costos, y debugging en H0. Si un evento requiere GPT-4o: loggear razon en engram, no escalar automaticamente. |
| DA-08 | Almacenamiento de audio/imagen | Buffer temporal en n8n (no persistir archivo) | Supabase Storage | En H0 con <5 fincas, no vale la pena el storage. El `media_ref` en `mensajes_entrada` guarda la referencia al media_id de WhatsApp (disponible 30 dias). Suficiente para debugging. H1: evaluar Supabase Storage si se necesitan los archivos originales. |
| DA-09 | Migraciones SQL | Archivos numerados en `backend/sql/` | Supabase migrations CLI | El repo no tiene framework. Archivos SQL numerados son la solucion mas simple y versionable. Se ejecutan manualmente contra Supabase en H0. Supabase CLI migrations es H1 si el equipo crece. |
| DA-10 | Flujos n8n separados | Un flujo por caso de uso (4 flujos) | Un mega-flujo con switches | Convencion CLAUDE.md. Flujos separados son mas faciles de debuggear, versionar, y mantener. Reduce riesgo de error al editar. |

---

## Rollback plan

Si el pipeline falla en produccion durante las pruebas H0:

1. **Nivel 1 — Error aislado en un flujo:** Desactivar el flujo con error en n8n. Los otros flujos siguen operando. Ejemplo: si flujo-02 falla, flujo-01 sigue recibiendo mensajes y puede responder "Estamos con un problema tecnico, tu mensaje quedo guardado." Los mensajes quedan en `mensajes_entrada` con `status='received'` para reprocesar manualmente.

2. **Nivel 2 — Error en extraccion LLM:** Si GPT-4o Mini produce outputs incorrectos de forma sistematica: cambiar el nodo de extraccion a un nodo de "bypass" que persiste todo como `nota_libre` con `status='requires_review'`. La captura de datos continua (descripcion_raw preservada por P5), pero sin estructuracion automatica. Revision humana.

3. **Nivel 3 — Error en STT:** Si GPT-4o Mini Transcribe falla: desactivar la rama de audio en flujo-02. Responder a audios: "Por el momento solo puedo procesar mensajes de texto. Podrias escribir tu reporte?" Degradacion gracil.

4. **Nivel 4 — Error en webhook/Meta API:** Si Meta Cloud API tiene problemas: n8n webhook sigue activo esperando. Los mensajes se bufferean en Meta y se reenvian cuando se restablece. No se pierden mensajes (Meta retiene hasta 72h).

5. **Nivel 5 — Error catastrofico (Supabase down):** Sin DB no hay pipeline. Comunicar a las fincas piloto por canal alternativo (llamada telefonica). Los mensajes de WhatsApp quedan en Meta. Al restaurar Supabase, los mensajes llegan via webhook normalmente.

**Principio general:** Cada componente puede degradar independientemente. El peor caso nunca es "se pierden datos" — siempre es "datos quedan como nota libre para revision humana".

---

## Riesgos y mitigaciones

| # | Riesgo | Impacto | Mitigacion elegida |
|---|---|---|---|
| R-01 | Latencia STT + LLM supera 30s para audios largos (>60s) | Alto — viola P3 | Acuse inmediato al recibir audio (D8) compra tiempo perceptual. Pipeline real puede tomar 30-45s pero el usuario ya tiene feedback. Truncar audios >90s con aviso. Timeout explicito en n8n con fallback a `nota_libre`. Monitorear con LangFuse. |
| R-02 | Meta reintenta webhook y genera eventos duplicados | Alto — datos duplicados | HTTP 200 inmediato en webhook antes de procesar (DA-02). `wa_message_id` UNIQUE en `mensajes_entrada` como segunda linea de defensa. Doble proteccion: velocidad + constraint. |
| R-03 | GPT-4o Mini inventa datos agricolas (viola R1/P1) | Alto — dato incorrecto puede causar dano economico | Prompt explicito con instruccion de devolver null. Validacion post-LLM: si `confidence_score < 0.3` en campos criticos -> `nota_libre`. Evals en LangFuse para detectar fabricacion sistematica. |
| R-06 | Audio con ruido severo -> STT basura -> LLM extrae basura con confidence alto | Alto — dato invalido persistido | Validacion semantica post-extraccion: si todos los campos criticos son null O confidence_score global < 0.3 -> no persistir como evento tipificado, ir a `nota_libre`. Sin VAD en H0, esta es la red de seguridad. |
| R-10 | n8n anade >5s de latencia acumulada en cadena de nodos | Medio — comprime presupuesto de 30s | Medir latencia por nodo en LangFuse desde dia 1. Si n8n supera 5s sistematicamente: evaluar Inngest/Temporal. Criterio de revision: CR2 en CLAUDE.md. |

---

## Condiciones de exito H0

El pipeline esta "funcionando" y listo para transicion a H1 cuando se cumplen TODAS estas condiciones medibles:

| # | Condicion | Metrica | Umbral |
|---|---|---|---|
| CE-01 | Eventos completos capturados | Eventos de campo con `status='processed'` por semana por finca activa | >= 10 eventos/semana/finca (NSM) |
| CE-02 | Field-level accuracy | % de campos extraidos correctamente vs revision humana (muestra de 50 eventos) | >= 85% (CR3) |
| CE-03 | Latencia end-to-end | P95 de tiempo desde recepcion de webhook hasta confirmacion al usuario | < 30s (P3) |
| CE-04 | Acuse de recibo | P95 de tiempo desde recepcion hasta envio de "Estoy procesando..." | < 5s (P3) |
| CE-05 | Tasa de nota_libre | % de mensajes que terminan como nota_libre vs eventos tipificados | < 25% (indica que la extraccion funciona para la mayoria) |
| CE-06 | WER STT | Word Error Rate en audios de campo reales (H-TEC-02, 20 audios) | < 25% (CR4) |
| CE-07 | Zero silent errors | Toda llamada LLM/STT tiene traza LangFuse correspondiente | 100% coverage (R4) |
| CE-08 | Onboarding completo | Fincas piloto con perfil completo (nombre, lotes, cultivo) | 100% de fincas activas |
| CE-09 | Uptime del pipeline | Disponibilidad del webhook + flujos n8n | > 95% durante periodo de prueba H0 |
| CE-10 | Sin datos fabricados | Revision humana de 50 eventos: cero campos inventados por el LLM | 0 fabricaciones (R1/P1) |

**Transicion a H1:** Cuando CE-01 a CE-10 se cumplen sostenidamente por 2 semanas consecutivas con al menos 3 fincas activas.
