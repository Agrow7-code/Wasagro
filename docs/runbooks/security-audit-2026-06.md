# Auditoría de seguridad — Wasagro (2026-06-11)

> Auditoría en 4 capas (infra · backend · frontend · base de datos) previa a la
> primera finca pagante (H0-R). Este documento es el reporte + plan + análisis de
> rendimiento + mantenimiento. Decisión asociada: [ADR 018](../decisions/018-security-hardening-h0r.md).
> Leyenda severidad: 🔴 Crítico · 🟠 Alto · 🟡 Medio · ⚪ Bajo. Estado: ✅ corregido
> en esta pasada · ⏳ pendiente (plan abajo).

## TL;DR

El backend ya era sólido (HMAC en webhooks Meta/Cal.com, OTP bcrypt, JWT validado,
comparaciones timing-safe, security headers, body-limits, anti-enumeración). La
auditoría encontró **2 críticas en el flujo de cobros** (webhooks de pago sin
verificar firma → cualquiera podía activar/cancelar suscripciones de cualquier
organización) y varios huecos de aislamiento/configuración. Se corrigieron en esta
pasada las críticas y los altos más sensibles (dinero, auth, multi-tenant). Queda
un set de mejoras de defensa-en-profundidad documentado en el plan.

---

## 1. Puertos y accesos

| Puerto | Servicio | Antes | Ahora | Notas |
|---|---|---|---|---|
| 3000 | LangFuse (self-hosted) | `0.0.0.0:3000` HTTP plano 🔴 | `127.0.0.1:3000` ✅ | Acceso remoto solo vía reverse-proxy TLS + auth |
| 3000 | Backend Hono (Railway) | Gestionado por Railway (TLS en el edge) | igual | `PORT` configurable; Railway termina TLS |
| 5432 | Supabase Postgres (prod) | IPs `0.0.0.0/0`, SSL no forzado 🟠 | SSL forzado ✅ + plan IP-restrict ⏳ | `config.toml`: `ssl_enforcement=true` |
| 54321-54329 | Supabase CLI (local dev) | loopback | igual | Solo desarrollo local, no expuesto |
| 443 | Vercel (landing/dashboard) | sin security headers 🟡 | CSP/HSTS/XFO ✅ | `landing/vercel.json` |

---

## 2. Hallazgos por capa

### Infraestructura
- 🔴→✅ **LangFuse expuesto en `0.0.0.0:3000` sobre HTTP.** Trazas con PII de campo
  alcanzables desde internet. Fix: bind loopback (`docker-compose.yml`).
- 🟠→✅ **Supabase: SSL no forzado.** Fix: `[db.ssl_enforcement] enabled=true`.
- 🟠→⏳ **Supabase: IPs `0.0.0.0/0`.** Requiere CIDRs reales de egress (Railway +
  admin). Pendiente: completar `allowed_cidrs` en el dashboard del proyecto.
- 🟠→✅ **LangFuse usa el rol `postgres` (superusuario).** Documentado rol
  least-privilege `langfuse_app` (solo schema `langfuse`) en su README.
- 🟡→✅ **CI `claude.yml` invocable por cualquiera con `@claude`.** Fix: gate por
  `author_association` (OWNER/MEMBER/COLLABORATOR).
- ⚪ Vercel Org/Project IDs en workflow (identificadores, no secretos) → mover a
  `vars` (higiene, no urgente). ⏳

### Backend
- 🔴→✅ **Webhook dLocal Go sin verificación de firma.** Activaba/cancelaba
  suscripciones de un `org_id` tomado de campos controlables. Fix: token compartido
  en `notification_url` + HMAC opcional, fail-closed (503 sin secret).
- 🔴→✅ **Webhook DeUna sin autenticación.** Confiaba en `metadata.org_id`. Mismo fix.
- 🟠→✅ **Rate limiter fail-open.** Si la RPC fallaba, dejaba pasar. Fix: `failClosed`
  en rutas `/auth/*` y `/api/auth/*` (503 ante fallo).
- 🟠→✅ **Cross-tenant: `admin_org` accedía a fincas de cualquier org.** Fix:
  `org_id` en JWT + `requireFincaAccessAsync` con verificación de pertenencia.
- 🟠→✅ **Ruta de auth paralela `api/auth/*.ts`** con CORS `*`+credentials y
  enumeración por 404. Fix: allow-list de orígenes + respuesta uniforme.
- 🟡→⏳ **Todo endpoint corre con service_role (RLS bypass).** `SUPABASE_ANON_KEY`
  es opcional y el middleware cae a service_role. Plan: hacerlo obligatorio.
- 🟡→⏳ **`change-plan` permite auto-asignar plan/precio sin pago.** No da acceso
  activo (planGuard sigue), pero ensucia el P&L. Plan: tratar como propuesta.
- 🟡→⏳ **Logs con PII** (teléfonos en claro en Cal.com/SDR; secret-prefix de Cal.com
  en logs de mismatch). Plan: redactar (patrón `slice(-4)` ya existe en pgBoss).
- ⚪→⏳ **JWT 7 días sin revocación.** Plan: `jti`/versión para logout remoto (D22).
- ⚪→⏳ **Dep `openai` presente pese a D3 "sin OpenAI".** Plan: remover dep no usada.

### Frontend
- 🟠→⏳ **JWT en `localStorage`** (exfiltrable por XSS). Plan: cookie httpOnly+SameSite.
- 🟠→⏳ **Llamadas `/api/finca/*` y `/api/metricas/*` sin header `Authorization`** en
  algunas vistas + `?phone=` como identidad. El servidor **sí** exige token y
  `requireFincaAccessAsync` (mitigado server-side); falta alinear el cliente. Plan:
  enviar `Authorization` en todas las vistas y quitar lookups por `?phone=`.
- 🟡→✅ **Sin security headers en el hosting.** Fix: `vercel.json` headers.
- 🟡→⏳ **PII en `console.log`** (teléfono/rol en LoginPage). Plan: guard `import.meta.env.DEV` + drop console en build.
- ⚪→⏳ **`wasagro-login.html`** prototipo con React dev + Babel-in-browser y OTP
  hardcodeado `371000` (es demo, no autentica). Plan: no desplegar a producción.

### Base de datos (migración 058 ✅)
- 🟠→✅ **`v_eventos_analisis` sin `security_invoker`** exponía `descripcion_raw` de
  todas las fincas. Fix: recreada con `security_invoker=on` + REVOKE a `anon`.
- 🟠→✅ **`buscar_eventos_similares` sin guard de pertenencia.** Fix: verifica que la
  finca sea de la org del llamante (service_role pasa).
- 🟡→✅ **`get_fincas_con_coordenadas` devolvía todas las fincas si org nula.** Fix:
  retorna vacío para usuario autenticado sin org.
- 🟡→✅ **SECURITY DEFINER sin `search_path`.** Fix: pineado en todas las del schema.
- 🟡→⏳ **`storage.objects` sin políticas para `eventos-media`.** El bucket es privado
  (deny por defecto); documentado. Plan: política explícita scoped al bucket.
- ⚪ **Falso positivo:** OTP NO está en texto plano — `otpService.ts` hashea con
  bcrypt antes de insertar; la columna `code` guarda el hash (nombre engañoso).

---

## 3. Plan de remediación (priorizado)

**Hecho en la 1ª pasada (P0/P1 más sensibles):** webhooks de pago, cross-tenant
`admin_org`, rate-limit fail-closed, ruta de auth paralela, migración 058 de BD,
LangFuse/Supabase/CI/headers de infra.

**Hecho en la 2ª pasada (pendientes accionables):**
- ✅ **Frontend auth:** `Authorization` en todas las vistas (`FincaSetupView`,
  `Calculadora` vía helper `authFetch`); eliminado el `?phone=` de `/api/auth/me`
  (la identidad sale del token). Helper `landing/src/auth/api.ts`.
- ✅ **PII en logs:** redacción de teléfonos (`redactPhone`, solo últimos 4) en
  OTP/auth/SDR/Cal.com; eliminado el `secretPrefix` y el body en los logs de fallo
  de firma de Cal.com; quitado teléfono/rol del `console.log` del LoginPage; Vite
  elimina `console.*` en el build de producción.
- ✅ **OTP budget global:** techo horario de envíos (`OTP_GLOBAL_HOURLY_BUDGET`,
  default 200/h) además de los límites por-teléfono y por-IP — anti cost-pumping.
- ✅ **LangFuse TLS:** `Caddyfile.example` (proxy TLS + Basic Auth) listo para usar.
- ✅ **`storage.objects`:** documentado deny-por-defecto en la migración 058.

**Pendiente — operativo (requiere acción fuera del repo):**
1. **Antes de cobrar:** configurar `DLOCALGO_WEBHOOK_SECRET` y `DEUNA_WEBHOOK_SECRET`
   en backend (Railway) y en el panel del proveedor; probar un cobro real e2e.
2. **Supabase `allowed_cidrs`:** completar con las IPs de egress reales (Railway +
   admin) en el dashboard del proyecto.
3. **LangFuse:** desplegar el reverse-proxy (Caddyfile.example) y crear el rol DB
   `langfuse_app` (SQL en el README) en vez del superusuario `postgres`.

**Pendiente — arquitectónico (no es fix puntual, requiere diseño/decisión):**
4. **RLS como barrera real:** el backend usa `service_role` (RLS bypass). Enrutar por
   cliente user-scoped NO funciona tal cual: nuestros JWT se firman con `JWT_SECRET`
   propio (hono/jwt), no con el secreto de Supabase Auth, así que `auth.uid()` no
   resuelve y la RLS negaría todo. Requiere emitir JWT compatibles con Supabase Auth
   (claims `sub`/`role`/`aud`, firma con el secreto de Supabase) o mover la auth a
   Supabase Auth. Hoy el aislamiento lo garantiza `requireFincaAccessAsync` (app) +
   las funciones/políticas endurecidas (BD).
5. **JWT en cookie httpOnly + CSRF:** reduce el riesgo de robo por XSS, pero
   introduce superficie CSRF (hoy el patrón Bearer en header no es CSRF-vulnerable) y
   exige tokens anti-CSRF + pruebas en navegador. El CSP ya añadido mitiga el XSS que
   habilitaría el robo. Decisión de tradeoff — diferida conscientemente.
6. **Revocación de JWT (logout remoto):** stateless hoy; un denylist/`token_version`
   cuesta 1 lectura DB por request. Para el dashboard (bajo tráfico) es viable;
   pendiente de decisión sobre TTL/UX.

**Falsos positivos descartados al verificar:**
- **Remover `openai`:** la dep SÍ se usa — `EmbeddingService.ts` la usa como cliente
  OpenAI-compatible para los embeddings de NVIDIA NIM (D12 RAG). No se remueve.
- **OTP en texto plano:** `otpService.ts` hashea con bcrypt antes de insertar.
- **`change-plan` sin pago:** no concede acceso activo (`planGuard` gatea por
  `subscription_status`, que este endpoint no toca; el plan/precio se confirman en el
  webhook de pago). Se deja como está para no romper el flujo de cotizar→pagar.
- **`wasagro-login.html`:** es un prototipo de diseño (OTP demo hardcodeado, no
  autentica) en la raíz; el deploy real es `landing/`. No desplegar a producción.

---

## 4. Análisis de rendimiento (impacto de los cambios)

- **`requireFincaAccessAsync`:** el caso común (agricultor accediendo a su propia
  finca) hace **0 queries** — corta por `finca_id` del JWT. Solo `admin_org`
  accediendo a una finca que no es la suya gasta **1 SELECT indexado** sobre
  `fincas` (PK `finca_id`), < 5 ms. `director` no consulta. Impacto despreciable.
- **Verificación de webhooks:** HMAC-SHA256 sobre ≤64 KB + comparación timing-safe →
  microsegundos. No añade I/O.
- **Rate limiter fail-closed:** misma ruta de ejecución; solo cambia el comportamiento
  ante error (503 en vez de pasar). Sin costo adicional.
- **Migración 058:** `security_invoker` hace que la vista respete RLS — añade el
  filtro de RLS a la consulta (despreciable con índices por `finca_id`). El guard de
  `buscar_eventos_similares` añade 1 SELECT a `usuarios`/`fincas` solo para usuarios
  autenticados (el backend usa service_role y lo saltea, que es el path del RAG).
- **OTP budget global:** añade 1 RPC `rate_limit_hit` al `request-otp` (ruta ya
  ligada a DB; fail-open ante error → no bloquea login). Despreciable.
- **Headers Vercel/CSP:** costo nulo en runtime; servidos como headers estáticos.
- **Conclusión:** ningún cambio toca el hot-path del pipeline de captura (P3: < 30 s).
  El overhead total por request autenticado es ≤ 1 query indexada y solo para el rol
  `admin_org` en accesos a fincas no-propias.

---

## 5. Recomendaciones de mantenimiento

- **Secretos:** rotar `JWT_SECRET`, claves dLocal/DeUna y `*_WEBHOOK_SECRET` cada 90
  días; nunca commitear `.env` (ya cubierto por `.gitignore`). Guardar como secretos
  gestionados en Railway/Vercel, no en archivos del host (`chmod 600` si inevitable).
- **Dependencias:** correr `npm audit` en CI; revisar y aplicar fixes mensualmente;
  remover deps no usadas (`openai`, `ollama` si no están en el pool activo, D3).
- **RLS como contrato:** en cada migración nueva que cree tabla con datos de finca,
  habilitar RLS + política org-scoped en la MISMA migración; verificar en prod con
  `SELECT tablename FROM pg_tables WHERE schemaname='public'` ↔ `pg_policies`.
- **Vistas:** toda VIEW sobre datos de finca debe crearse con `security_invoker=on`.
- **Webhooks:** todo endpoint que reciba de un tercero verifica firma sobre el body
  **raw** antes de parsear (patrón Meta/Cal.com/dLocal ya establecido).
- **Logs:** redactar teléfonos/PII (`slice(-4)`); jamás loggear secretos ni OTP.
- **Observabilidad:** LangFuse solo detrás de TLS+auth; revisar accesos.
- **Revisión:** repetir esta auditoría antes de cada salto de horizonte (H0-R→H1) y
  al añadir cualquier flujo que toque dinero, auth o datos entre organizaciones.

---

🤖 Generado por Claude Code — 2026-06-11
