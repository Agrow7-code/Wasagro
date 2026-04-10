# Wasagro — CLAUDE.md

> Este archivo es el cerebro del proyecto para Claude Code. Tres capas: principios que nunca cambian, criterios que cualquier herramienta debe cumplir, y decisiones actuales que se revisan con datos.

## Identidad del proyecto

Wasagro es un sistema operativo de campo agrícola AI-first. Captura datos en fincas de exportación (cacao/banano) en Ecuador/Guatemala via WhatsApp (voz, texto, imagen), los estructura con IA, y genera reportes y alertas.

**Horizonte actual: H0 — Validación del problema.**
**Métrica Norte: Eventos de campo completos por semana por finca activa.**
**Modelo de negocio: B2B enterprise — exportadora paga, agricultor usa gratis.**

## SSOT — Dónde vive cada cosa

| Capa | Herramienta | Qué vive ahí | Cómo acceder |
|---|---|---|---|
| Producto (qué, por qué, para quién) | **Notion** | Manual Maestro, hipótesis, riesgos, pipeline, decisiones | MCP Notion — nunca copiar, siempre referenciar |
| Técnica (cómo, qué se construyó) | **GitHub** (este repo) | Schema SQL, docs técnicos, flujos, código | Leer directamente |
| Steering de desarrollo | **CLAUDE.md** (este archivo) | Principios, criterios, decisiones actuales | Se lee automáticamente al inicio |
| Code review | **AGENTS.md** | Guardrails que GGA verifica en cada commit | GGA lo lee en pre-commit |
| Memoria persistente | **Engram** | Decisiones técnicas, errores, aprendizajes entre sesiones | MCP engram: mem_search, mem_save |

**Regla anti-duplicación:** Si un dato ya vive en Notion o en otro archivo del repo, NO lo copies aquí. Referencia la ubicación.

---

## CAPA 1 — Principios invariantes

> Estos principios son independientes de cualquier herramienta, framework, o proveedor. No cambian si migramos de Supabase a otro Postgres, de n8n a Inngest, o de GPT-4o Mini a Voxtral. Si una decisión técnica viola un principio, se cambia la decisión, no el principio.

### P1. El agente nunca inventa datos

Si no tiene información, pregunta. Si no puede extraer un campo, lo marca como `null` con `confidence_score` bajo. Jamás fabrica un lote, una dosis, o un producto. Una asunción incorrecta en agricultura puede causar daño económico real e irreversible.

### P2. Máximo 2 preguntas de clarificación

Después de 2 preguntas sin completar, registrar como `nota_libre` con `status='requires_review'`. Investigación con 200K+ conversaciones demuestra que el rendimiento de LLMs cae 39% en conversaciones multi-turno. No torturar al usuario con preguntas.

### P3. Latencia < 30 segundos

Acuse de recibo al usuario en <5 segundos. Respuesta estructurada completa en <30 segundos. Si el pipeline tarda más, enviar "Estoy procesando tu reporte..." inmediatamente. Un trabajador que camina al siguiente lote tiene 30-60 segundos de ventana de atención.

### P4. Todo error se loggea sin excepción

Toda llamada a LLM, toda transcripción STT, todo error de extracción queda registrado en el sistema de observabilidad. El log incluye: input raw, output estructurado, confidence_score, modelo usado, latencia. No existen catch vacíos ni errores silenciosos.

### P5. Los datos del campo pertenecen a la finca

Wasagro tiene licencia de uso para procesar datos, no propiedad. La exportadora solo ve lo que la finca autoriza. Ningún dato se agrega o vende sin consentimiento explícito. Todo evento conserva `descripcion_raw` (input original) junto al JSON estructurado.

### P6. Consentimiento antes de capturar

Consentimiento documentado ANTES de capturar cualquier dato. Tabla `user_consents` con timestamp, tipo, y texto exacto mostrado. Si el primer mensaje es un audio con datos útiles: procesarlo como dato provisional, pedir consentimiento inmediatamente después, borrar si no acepta.

### P7. Ninguna acción irreversible sin aprobación humana

El agente informa, no ordena. En H0-H1 opera en niveles de autonomía 2-3 (colaborador/consultor). DELETE en producción, envío de mensajes que modifiquen datos, cambio de consentimiento — todo requiere confirmación explícita.

---

## CAPA 2 — Criterios de evaluación

> Estos criterios definen qué debe cumplir cualquier herramienta que usemos. Si una herramienta deja de cumplirlos, se reemplaza. Claude Code puede proponer cambios de herramienta justificando contra estos criterios — nunca contra el nombre de la herramienta anterior.

### CR1. Base de datos

- PostGIS para geolocalización EUDR (polígonos con 6 dígitos decimales)
- JSONB para datos semi-estructurados (`datos_evento` varía por tipo)
- Auth integrado o compatible (onboarding via WhatsApp)
- Row Level Security o equivalente para aislamiento por finca
- Costo < $80/mes a 100 fincas activas
- Hosted/managed (equipo de 1-2 personas)

### CR2. Orquestador de flujos

- Webhooks HTTP para recibir mensajes de WhatsApp Business API
- Llamadas a APIs externas (LLM, STT, WhatsApp)
- Manejo de errores con retry y logging
- Flujos editables sin redespliegue completo
- Visual o declarativo preferible (reduce bus factor)
- Costo < $50/mes en H0

### CR3. Modelo LLM de texto

- Español latinoamericano con jerga agrícola
- Extracción de entidades a JSON con field-level accuracy ≥85%
- System prompts largos con reglas de dominio
- Latencia < 5 segundos para ~600 tokens input
- Costo < $0.15/finca/mes a 480 eventos/finca/mes
- API estable con buena documentación

### CR4. Modelo STT

- WER < 25% en español LATAM con jerga agrícola, ruido ambiental, y cortes de señal
- Soporte para .opus (formato WhatsApp)
- Latencia < 10 segundos para audios de 45 segundos
- Vocabulario personalizable o post-corrección viable con LLM
- Costo < $1.50/finca/mes (360 min audio/finca/mes)

### CR5. Sistema de observabilidad

- Trazabilidad de cada llamada LLM y STT: input, output, latencia, costo
- Soporte para datasets de evaluación (eval_dataset + eval_results)
- Costo < $10/mes en H0 (self-hosted aceptable)

### CR6. Canal de mensajería

- Business API oficial (no scrapers)
- Texto, audio (.opus), imagen
- Templates para mensajes proactivos fuera de ventana 24h
- Webhook configurable
- Pricing transparente por mensaje/template

---

## CAPA 3 — Decisiones actuales

> Estas son las herramientas que usamos HOY porque cumplen los criterios de la Capa 2. Cada decisión tiene fecha, justificación, y condición concreta de revisión. Claude Code puede proponer cambios — el debate es contra los criterios, no contra la herramienta.

### D1. Base de datos: Supabase (Plan Pro)

- **Fecha:** Abril 2026
- **Cumple:** CR1 completo — PostGIS, JSONB, Auth, RLS, $25/mes, managed.
- **Revisar cuando:** Volumen >8GB DB o >250GB storage, o necesidad de graph queries. Estimado: >100 fincas.

### D2. Orquestador: n8n

- **Fecha:** Abril 2026
- **Cumple:** CR2 completo — webhooks, APIs, retry, visual, $20/mes.
- **Revisar cuando:** Cada flujo requiera custom code nodes, o latencia de n8n añada >5s al pipeline. Alternativas: Inngest, Temporal, TypeScript custom.

### D3. LLM de texto: GPT-4o Mini

- **Fecha:** Abril 2026
- **Cumple:** CR3 — español LATAM, JSON extraction, ~2s latencia, ~$0.09/finca/mes.
- **Revisar cuando:** Field-level accuracy en evals <85% con datos reales. En H0, GPT-4o Mini para TODO. Si un evento requiere GPT-4o, loggear en engram por qué.

### D4. STT: GPT-4o Mini Transcribe

- **Fecha:** Abril 2026
- **Cumple:** CR4 parcial — $0.003/min, .opus, latencia ok. WER en campo no validado aún (H-TEC-02).
- **Revisar cuando:** Resultados de H-TEC-02 (20 audios, 4 modelos). Si Voxtral demuestra mejor WER, migrar. Si Whisper self-hosted alcanza WER comparable a <$0.001/min, migrar en H1.

### D5. Observabilidad: LangFuse self-hosted

- **Fecha:** Abril 2026
- **Cumple:** CR5 — trazabilidad completa, evals, $0/mes (Postgres compartido con Supabase).
- **Revisar cuando:** Volumen de traces sature el Postgres compartido. Alternativa: LangFuse Cloud (free tier 50K traces/mes).

### D6. Canal: WhatsApp Business API — Meta Cloud API directo

- **Fecha:** Abril 2026
- **Cumple:** CR6 completo — API oficial, multimodal, templates, webhooks.
- **H0:** Meta Cloud API directo — sin intermediario (ni Wati ni 360Dialog). n8n conecta al webhook nativo de Meta. Mensajes user-initiated dentro de ventana 24h = $0. phone_number_id y WABA_ID portables a H1.
- **Revisar cuando:** Volumen supere tier no verificado de Meta, o se requiera verificación formal de empresa en H1. BSP alternativo: 360Dialog o Wati.

---

## Estructura del repo

```
wasagro-architecture/
├── CLAUDE.md              ← Este archivo
├── AGENTS.md              ← Reglas para GGA
├── .gga                   ← Config de GGA
├── backend/
│   └── sql/
│       └── 01-schema-core.sql
├── docs/
│   ├── 01-problema-y-contexto.md
│   ├── 02-arquitectura-ai-first.md
│   ├── 07-costos-y-modelo-economico.md  ← ⚠️ WhatsApp pricing desactualizado, ver Notion
│   └── 08-roadmap-mvp-v1-v2.md
├── flows/                 ← Flujos del orquestador
└── prompts/               ← System prompts del agente Wasagro
```

## Convenciones de código

### SQL

- Tablas en español snake_case: `eventos_campo`, `user_consents`
- UUIDs como PK (excepto `finca_id`/`lote_id`: TEXT F001, F001-L01)
- JSONB para `datos_evento`
- PostGIS para `coordenadas` (POINT) y `poligono` (POLYGON)
- Migraciones numeradas: `02-patch-consents.sql`

### Prompts del agente

- Voz y Tono: Notion → Sección 04
- Vocabulario prohibido: "base de datos", "JSON", "tipo de evento", "sistema", "plataforma", "registrado exitosamente", "reformular"
- Tuteo Ecuador/Guatemala. Máx 3 líneas. Emojis solo ✅ ⚠️.

### Flujos del orquestador

- Un flujo por caso de uso
- Nodos con nombre descriptivo en español

## Glosario de campo

| Término | Significado | Conversión |
|---|---|---|
| Bombada | Tanque de 20L aspersora | 1 bombada = 20L |
| Caneca | Recipiente grande | ~100L |
| Quintal / qq | Unidad de peso | 1 qq = 45.4 kg |
| Jornal | 1 persona × 1 día | Mano de obra |
| Colino | Hijo/rebrote de planta | Conteo por mata |
| Escoba | Foco de Moniliophthora | Enfermedad cacao |
| Helada | Alta incidencia moniliasis | No = clima frío |
| Riel | Cable aéreo empacadora | Cajas banano |
| Mazorca negra | Fruto cacao enfermo | Clasificar plaga |
| Rechazo | Fruta no exportable | Porcentaje |
| Brix | Grados madurez | Número |

## Al inicio de cada sesión

1. Leer este archivo (automático)
2. `mem_search` en engram para decisiones recientes
3. Si necesitas contexto de Notion, leer via MCP (no copiar)
4. Preguntar: "¿Qué vamos a construir hoy?" — no asumir

## Sincronización automática

Al completar cada fase SDD (explore → propose → approve → build → done):

1. `git add . && git commit && git push origin main`
2. Actualizar páginas de Notion afectadas vía Notion MCP
3. Al final de cada página de Notion actualizada, agregar: `🤖 Actualizado automáticamente por Claude Code — [fecha] — [fase SDD]`
4. Registrar en engram qué páginas de Notion se actualizaron y qué cambió
