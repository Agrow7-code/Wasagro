# Propuesta — onboarding-hardening

**Change name:** `onboarding-hardening`
**Fase:** SDD / propose
**Proyecto:** Wasagro (H0-R → producción, no-MVP)
**Artifact store:** openspec (este archivo + `specs/` + `design.md`)
**Idioma:** español neutro (artefactos de código en inglés, por regla del proyecto)

---

## 1. Por qué / problema

El agente de onboarding conversacional (D16, `OnboardingHandler.ts` + prompts `sp-04a/sp-04b`) está **bien construido en el camino feliz** y **abandona silenciosamente al cliente en los caminos infelices**. Auditoría de código (2026-06-21) sobre `OnboardingHandler.ts`, `procesarMensajeEntrante.ts`, `sp-04a-onboarding-admin.md`, `sp-04b-onboarding-agricultor.md`.

Con Wasagro **ya recibiendo prospectos reales** (postura no-MVP, CLAUDE.md), un onboarding que se traba sin recuperación ni señal es un riesgo directo de perder una finca pagante recién cerrada. El estándar es production-readiness, y los caminos infelices del onboarding **no lo cumplen hoy**.

Además, el founder pidió explícitamente **"un lugar para ver el onboarding de los clientes"** y hoy **no existe ninguna superficie**: si un admin se traba o un agricultor espera aprobación, la única señal es un evento `WARNING` enterrado en Langfuse. Cero visibilidad operativa.

### Hallazgos de la auditoría (severidad)

| # | Hallazgo | Dónde | Severidad |
|---|---|---|---|
| 1 | **Callejón sin salida a los 10 pasos:** sesión→`completed` pero `onboarding_completo=false` → cliente atrapado, re-rutea a onboarding por siempre, nunca llega a `handleEvento`. Sin `requires_review`, sin recuperación, sin aviso. | `OnboardingHandler.ts:172-180` + `procesarMensajeEntrante.ts:131` | 🔴 CRÍTICO |
| 2 | **Promesa colgada en activación:** el agente cierra con *"¿quieres que te explique cómo funciona?"* y en el MISMO turno marca `onboarding_completo=true`. El "sí" siguiente entra a `handleEvento` (extracción de evento), no a onboarding. Mismo anti-patrón que el follow-up de Sigatoka. | `sp-04a` paso 6 + handler | 🔴 CRÍTICO |
| 3 | **Rechazo de consentimiento = limbo mudo:** "FIN" deja `onboarding_completo=false` → loop de re-preguntar; el founder no se entera de que un deal cerrado se trabó en el consentimiento legal (P6). | `sp-04a`/`sp-04b` paso 2 | 🔴 CRÍTICO |
| 4 | **Cero visibilidad founder del onboarding en curso/trabado.** La data existe (`getPendientesAprobacion`, `sesiones_activas.contexto_parcial`) pero no está expuesta a ninguna superficie. | (ausencia) | 🟠 ALTO |
| 5 | **Agricultor colgado si el jefe ignora la aprobación:** mecanismo existe (`handleAprobacion`), resiliencia no: sin re-nudge al jefe, sin timeout, sin escalamiento. | `OnboardingHandler.ts:266-287` | 🟠 ALTO |
| 6 | **P2 ("máx 2 intentos por paso") vive solo en el prompt, no en código.** El LLM controla `siguiente_paso`; sin backstop estructural el único límite es el techo de 10 (= hallazgo #1). | prompts + handler | 🟡 MEDIO |
| 7 | **Fallo de STT deja `texto=''`** y se lo pasa al LLM, que re-pregunta a ciegas, sin "no te entendí el audio, ¿lo escribís?". | `OnboardingHandler.ts:89-93,209-227` | 🟡 MEDIO |

### Qué es éxito

Un onboarding que **nunca abandona en silencio**: todo camino infeliz termina en un estado **recuperable y visible** — `requires_review` con aviso al founder, re-nudge al jefe, o señal clara al usuario — en vez de un limbo donde `onboarding_completo` queda false para siempre. Y el founder **se entera por WhatsApp** cuando un onboarding se traba, sin depender de la UI `/admin` (todavía inexistente).

---

## 2. Qué cambia (scope de ESTE change)

### A. Resiliencia del agente (caminos infelices)

1. **Estado terminal recuperable en vez de limbo (#1):** cuando el onboarding llega al tope de pasos o no puede completarse, el usuario pasa a un estado explícito `onboarding_requires_review` (no a un `completed` que miente). Se decide en design el mecanismo exacto (columna/status), pero la regla es: **un onboarding que no termina queda marcado para intervención humana, no en loop**, alineado con P2.
2. **Cortar la promesa colgada (#2):** el paso de activación **no ofrece** lo que la arquitectura no entrega en el siguiente turno, o el flujo retiene el control para responder la explicación antes de marcar `onboarding_completo`. Resolución de diseño: o se quita la oferta, o se modela un mini-estado post-onboarding. Mismo aprendizaje que el follow-up de Sigatoka.
3. **Señal en rechazo de consentimiento (#3):** rechazar consentimiento es un **estado terminal explícito y notificado al founder** (deal cerrado trabado en P6), no un dead-end que re-pregunta. El usuario recibe un cierre claro; el founder recibe el aviso.
4. **Resiliencia de aprobación del agricultor (#5):** re-nudge al jefe tras un timeout configurable y escalamiento al founder si nadie aprueba. Reusa el patrón de chaser de pg-boss (D24) o un job simple; design define el mecanismo.
5. **Backstop estructural de P2 (#6):** el límite de intentos deja de depender solo del prompt; el código garantiza que tras N intentos sin avanzar se va a `requires_review`, no a un loop infinito ni al techo-callejón.
6. **Degradación explícita de STT (#7):** si la transcripción falla, el agente lo dice ("no te entendí el audio, ¿lo escribís?") en vez de re-preguntar a ciegas con `texto=''`.

### B. Visibilidad founder — slice 1 (alerta proactiva)

7. **Alerta proactiva por WhatsApp al founder** cuando un onboarding se traba (entra a `requires_review`, rechaza consentimiento, o supera el timeout de aprobación). Reusa `FOUNDER_PHONE` (ya existe y se usa en `procesarMensajeEntrante.ts:88` + `handleFounderApproval`). Da visibilidad **inmediata** sin depender de UI.

---

## 3. Non-goals (explícitamente FUERA de este change)

- **Vista rica de onboardings en el back-office `/admin`** (lista de onboardings en curso, drill-in, métricas de conversión). **Se delega a `founder-backoffice`** — esa UI no existe aún (S3 del epic) y bloquearía estos fixes. Este change deja la **data y el endpoint** listos para que esa vista los consuma; entrega la visibilidad founder vía **alerta WhatsApp** mientras tanto.
- **Rediseño del flujo de pasos del onboarding** (el happy path funciona; no se reescribe).
- **Alta de cuenta / provisioning** (eso es `client-provisioning`; este change asume que el usuario ya existe en `usuarios`).
- **Cambios en el pipeline de eventos de campo** (`handleEvento`) más allá de no robarle turnos al onboarding.
- **Self-serve / signup público.**

---

## 4. First-slice boundary

**Entra en ESTE change:**
- Estado terminal recuperable (`requires_review`) para onboarding que no completa (#1, #6).
- Fix de la promesa colgada de activación (#2).
- Cierre + señal en rechazo de consentimiento (#3).
- Re-nudge + escalamiento de aprobación del agricultor (#5).
- Degradación explícita de STT en onboarding (#7).
- Alerta WhatsApp al founder en onboarding trabado (#4 slice 1).

**Queda para after:**
- Vista de onboardings en `/admin` (→ `founder-backoffice`).
- Métricas de conversión / funnel de onboarding (tasa de completitud, paso donde se traban).
- Reanudación "bienvenido de nuevo, retomemos donde quedamos" tras gap largo (mejora de UX, no abandono).

---

## 5. Reglas de negocio y edge cases

- **P2 (máx 2 preguntas/intentos):** el destino tras agotar intentos es `requires_review`, NO un loop ni el techo-callejón. Hoy P2 vive solo en el prompt; este change le da backstop en código.
- **P4 (todo error se loggea):** cada transición a `requires_review`, cada alerta al founder y cada fallo de STT queda en observabilidad. Sin catch vacíos.
- **P6 (consentimiento):** rechazar consentimiento es terminal y auditado; no se captura dato de campo sin consentimiento. El estado terminal no borra el `descripcion_raw` de lo ya recibido (provisional) — se respeta P6 sobre borrado.
- **P7 (acción irreversible con aprobación humana):** el escalamiento de aprobación del agricultor **no auto-aprueba** — solo re-notifica/escala; la activación sigue requiriendo el "aprobar X" del jefe.
- **Idempotencia de alertas:** un onboarding trabado **no debe spamear** al founder en cada turno. La alerta se emite una vez por transición a estado trabado (guard idempotente, patrón del consent monotónico ya usado en el handler).
- **Edge — sesión `completed` legítima vs. atrapada:** distinguir el onboarding que terminó OK (`onboarding_completo=true`) del que tocó techo (`requires_review`). Hoy ambos terminan en sesión `completed` — esa ambigüedad es la raíz del #1.
- **Edge — agricultor vs admin:** el agricultor tiene un terminal extra (`pendiente_aprobacion`) que NO es trabado — es espera legítima. El timeout #5 distingue "esperando aprobación normal" de "abandonado".

---

## 6. Impacto

### Código
- `src/pipeline/handlers/OnboardingHandler.ts` — estados terminales recuperables; guard de intentos; degradación STT; emisión de alerta founder.
- `prompts/sp-04a-onboarding-admin.md` / `sp-04b-onboarding-agricultor.md` — quitar/ajustar la promesa colgada del paso de activación; copy de cierre en rechazo de consentimiento.
- `src/pipeline/procesarMensajeEntrante.ts` — ruteo del nuevo estado `requires_review` (no debe re-loopear a onboarding ni caer a `handleEvento`).
- `src/pipeline/supabaseQueries.ts` — query/helper para onboardings trabados (consumible por el endpoint diferido del back-office); helper de transición de estado.
- (Posible) `src/workers/` — job de timeout/re-nudge de aprobación del agricultor (D24 pattern) si design elige pg-boss.
- (Posible) helper de alerta founder reutilizable (hoy el patrón está inline en `handleFounderApproval`).

### Tablas / migraciones (a confirmar en design)
- `usuarios` y/o `sesiones_activas` — representar el estado `onboarding_requires_review` sin colisionar con `onboarding_completo` ni con `status='pendiente_aprobacion'`. Posible nueva columna o uso de `status` existente. **Decisión de design.**
- Posible registro de la alerta enviada (idempotencia) — columna/tabla mínima o flag en `contexto_parcial`.

### Endpoints
- (Diferido a founder-backoffice, pero la data se deja lista) ningún endpoint nuevo obligatorio en este slice; la visibilidad va por WhatsApp.

### Observabilidad (P4)
- Eventos Langfuse nuevos: `onboarding_stuck`, `onboarding_consent_rejected`, `agricultor_approval_timeout`, `founder_alert_sent`, `onboarding_stt_degraded`.

---

## 7. Riesgos abiertos (para spec/design)

1. **Modelado del estado terminal:** ¿columna nueva en `usuarios`, reuso de `status`, o flag en `sesiones_activas`? Impacta el ruteo de `procesarMensajeEntrante` y la query de visibilidad. **Decisión de design.**
2. **Promesa colgada — quitar vs. retener control:** la solución más simple es quitar la oferta de explicación; la más rica es un mini-estado post-onboarding. Design elige según costo/valor.
3. **Timeout de aprobación del agricultor:** ¿job pg-boss (D24) o check lazy en el próximo inbound? pg-boss es más robusto pero más superficie; lazy es más barato pero no dispara sin actividad. **Decisión de design.**
4. **Idempotencia de la alerta founder:** garantizar una alerta por transición, sin spam, sobreviviendo a retries del worker (patrón monotónico del consent).
5. **Distinguir terminal-OK de terminal-trabado** sin romper jobs/queries que hoy asumen la semántica actual de `completed` / `onboarding_completo`.
6. **Compatibilidad con el SDR guard** (`shouldSuppressOnboardingForActiveSDR`): el nuevo estado no debe colisionar con la supresión de onboarding durante un pitch SDR activo.
7. **Relación con `founder-backoffice`:** este change debe dejar la query de onboardings trabados **agnóstica del consumidor** para que la UI `/admin` la absorba sin reescribir (mismo principio que `provisionarCliente`).

---

## 8. Enfoque elegido (resumen)

**Endurecer los caminos infelices del onboarding existente + dar visibilidad founder por WhatsApp**, sin reescribir el happy path ni bloquearse en la UI `/admin`. Esfuerzo medio, encaje no-MVP alto: convierte el abandono silencioso en estados recuperables y visibles, que es exactamente lo que separa "anda en la demo" de "listo para un cliente pagante". La vista rica queda delegada a `founder-backoffice`, consumiendo la data que este change deja lista.

**Next recommended:** `sdd-spec` + `sdd-design` (en paralelo).
