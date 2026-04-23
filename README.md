# Wasagro

Sistema operativo de campo agrícola AI-first. Captura datos en fincas via WhatsApp (voz, texto, imagen), los estructura con IA, y genera reportes y alertas.

## Variables de entorno

### Críticas — la app no arranca sin estas

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase (service_role) |
| `WASAGRO_LLM` | Proveedor LLM: `gemini` o `ollama` |
| `WHATSAPP_PROVIDER` | Proveedor WhatsApp: `evolution` o `meta` |
| `GEMINI_API_KEY` | Requerido si `WASAGRO_LLM=gemini` |
| `WHATSAPP_APP_SECRET` | Requerido por ambos providers (firma de webhook) |
| `EVOLUTION_API_URL` | Requerido si `WHATSAPP_PROVIDER=evolution` |
| `EVOLUTION_API_KEY` | Requerido si `WHATSAPP_PROVIDER=evolution` |
| `EVOLUTION_INSTANCE` | Nombre de instancia Evolution API |
| `WHATSAPP_PHONE_NUMBER_ID` | Requerido si `WHATSAPP_PROVIDER=meta` |
| `WHATSAPP_ACCESS_TOKEN` | Requerido si `WHATSAPP_PROVIDER=meta` |

### Opcionales — funcionalidades degradadas sin estas

| Variable | Descripción | Impacto si falta |
|---|---|---|
| `DEMO_BOOKING_URL` | URL de Calendly para demos (ej. `https://calendly.com/...`) | No se envían links de demo |
| `CALENDAR_ICS_URL` | URL privada ICS de Google Calendar | Sin verificación de disponibilidad por ICS |
| `GCAL_CLIENT_ID` | OAuth2 client ID de Google Calendar API | Sin agendamiento automático de reuniones |
| `GCAL_CLIENT_SECRET` | OAuth2 client secret de Google Calendar API | Sin agendamiento automático de reuniones |
| `GCAL_REFRESH_TOKEN` | Refresh token OAuth2 (generado con `scripts/setup-gcal-auth.mjs`) | Sin agendamiento automático de reuniones |
| `REPORTE_SECRET` | Secret para `POST /reportes/semanal` | Endpoint sin protección |
| `LANGFUSE_SECRET_KEY` | Clave secreta LangFuse | Sin observabilidad de LLM |
| `LANGFUSE_PUBLIC_KEY` | Clave pública LangFuse | Sin observabilidad de LLM |
| `LANGFUSE_BASE_URL` | URL de LangFuse (default: cloud) | — |
| `OLLAMA_BASE_URL` | URL de Ollama (default: `http://localhost:11434`) | — |
| `OLLAMA_MODEL` | Modelo Ollama (default: `llama3.2`) | — |
| `GEMINI_MODEL` | Modelo Gemini (default: `gemini-2.0-flash`) | — |

## Setup de Google Calendar (agendamiento automático)

Para activar el agendamiento automático de reuniones con Meet link:

1. Crear credenciales OAuth2 en Google Cloud Console (tipo "Desktop app")
2. Copiar `GCAL_CLIENT_ID` y `GCAL_CLIENT_SECRET` en Railway
3. Ejecutar: `node scripts/setup-gcal-auth.mjs`
4. Seguir el flujo OAuth en el navegador
5. Copiar el `GCAL_REFRESH_TOKEN` resultante en Railway

## Arquitectura

Ver `docs/02-arquitectura.md` y los ADRs en `docs/decisions/`.
