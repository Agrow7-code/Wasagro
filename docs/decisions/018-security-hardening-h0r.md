# 018 — Endurecimiento de seguridad H0-R (infra + backend + frontend + BD)

**Fecha:** 2026-06-11
**Estado:** Aceptada

## Contexto

Antes de la primera finca pagante (H0-R) se hizo una auditoría de seguridad en
cuatro capas (infraestructura, backend, frontend, base de datos). El backend ya
era razonablemente maduro (HMAC en webhooks de Meta/Cal.com, comparaciones
timing-safe, OTP hasheado con bcrypt, JWT con longitud mínima, body-limits,
security headers, padding anti-enumeración). La auditoría encontró, sin embargo,
dos vulnerabilidades **críticas** en el flujo de cobros y varios huecos altos.

El reporte completo, el plan priorizado, el análisis de rendimiento y las
recomendaciones de mantenimiento viven en `docs/runbooks/security-audit-2026-06.md`.

## Decisión

Se aplicaron en esta iteración los fixes más sensibles (los que tocan dinero,
autenticación y aislamiento entre fincas):

1. **Webhooks de pago verificados (CRÍTICO).** `dLocal Go` y `DeUna` ahora exigen
   verificación (token compartido en `notification_url` que controlamos, o firma
   HMAC sobre el body raw) antes de tocar el estado de suscripción. Fail-closed:
   sin `DLOCALGO_WEBHOOK_SECRET` / `DEUNA_WEBHOOK_SECRET` el endpoint responde 503.
   Util compartida en `src/integrations/webhookSecurity.ts`.
2. **Aislamiento cross-tenant (ALTO).** `requireFincaAccess` daba acceso amplio a
   cualquier `admin_org` sin comparar organización. Se agregó `org_id` al JWT y
   `requireFincaAccessAsync`, que limita a `admin_org` a fincas de su propia org
   (`director` sigue siendo global, back-office interno D28).
3. **Rate limiter fail-closed en auth/OTP (ALTO).** Antes dejaba pasar todo si la
   RPC fallaba; ahora responde 503 en las rutas de auth.
4. **Ruta de auth paralela endurecida.** Los handlers serverless `api/auth/*.ts`
   tenían CORS comodín con credenciales y filtraban existencia de usuarios (404).
   Se alinearon a una allow-list de orígenes y respuesta uniforme anti-enumeración.
5. **BD: vistas y funciones (migr. 058).** `v_eventos_analisis` recreada con
   `security_invoker` (aplica RLS); `buscar_eventos_similares` con guard de
   pertenencia; `get_fincas_con_coordenadas` ya no devuelve todas las fincas ante
   org nula; `search_path` pineado en toda función SECURITY DEFINER.
6. **Infra.** LangFuse deja de exponerse en `0.0.0.0` (bind a `127.0.0.1`);
   Supabase con `ssl_enforcement` activo y mínimo de contraseña 8; workflow
   `claude.yml` con gate por `author_association`.
7. **Frontend.** Cabeceras de seguridad (CSP, HSTS, X-Frame-Options, etc.) en el
   hosting Vercel del landing/dashboard.

## Consecuencias

- **Se gana:** el flujo de cobros no es forjable; el aislamiento por finca tiene
  backstop a nivel de app y de BD; los endpoints de auth no fallan-abierto.
- **Se pierde / costo operativo:** hay que configurar `DLOCALGO_WEBHOOK_SECRET` y
  `DEUNA_WEBHOOK_SECRET` en el proveedor y en el backend **antes** de cobrar (si
  no, los webhooks responden 503). Los JWT viejos no llevan `org_id`: un
  `admin_org` con token previo deberá re-loguear para recuperar acceso multi-finca.
- **Pendiente (ver runbook):** hacer `SUPABASE_ANON_KEY` obligatorio para que la
  RLS sea la barrera real (hoy el backend usa service_role); sacar el JWT del
  `localStorage` del frontend a cookie httpOnly; CAPTCHA/budget global de OTP.
