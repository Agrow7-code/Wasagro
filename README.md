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
| `REPORTE_SECRET` | Secret para `POST /reportes/semanal` | Endpoint sin protección |
| `LANGFUSE_SECRET_KEY` | Clave secreta LangFuse | Sin observabilidad de LLM |
| `LANGFUSE_PUBLIC_KEY` | Clave pública LangFuse | Sin observabilidad de LLM |
| `LANGFUSE_BASE_URL` | URL de LangFuse (default: cloud) | — |
| `OLLAMA_BASE_URL` | URL de Ollama (default: `http://localhost:11434`) | — |
| `OLLAMA_MODEL` | Modelo Ollama (default: `llama3.2`) | — |
| `GEMINI_MODEL` | Modelo Gemini (default: `gemini-2.0-flash`) | — |

## Arquitectura

Ver los ADRs en `docs/decisions/`.
