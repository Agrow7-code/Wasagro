# Wasagro

Sistema operativo de campo agrícola AI-first. Captura datos en fincas via WhatsApp (voz, texto, imagen), los estructura con IA, y genera reportes y alertas.

## Variables de entorno

### Críticas — la app no arranca sin estas

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase (service_role) |
| `WASAGRO_LLM` | Proveedor LLM: `auto`, `gemini`, `ollama`, `groq`, `deepseek`, `glm`, `minimax`, `qwen`, `gemma` |
| `WHATSAPP_PROVIDER` | Proveedor WhatsApp: `evolution` o `meta` |
| `GEMINI_API_KEY` | Requerido si `WASAGRO_LLM=gemini` o `auto` (recomendado) |
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
| `GEMINI_MODEL` | Modelo Gemini (default: `gemini-2.5-flash`) | — |
| `GEMINI_FAST_MODEL` | Tier fast (default: `gemini-2.5-flash`) | — |
| `GEMINI_PRO_MODEL` | Tier reasoning (default: `gemini-2.5-pro`) | — |
| `GROQ_API_KEY` | Para tier fast con Groq (llama-3.3-70b) | — |
| `GROQ_MODEL` | Modelo Groq (default: `llama-3.3-70b-versatile`) | — |
| `NVIDIA_API_KEY` | Para providers NVIDIA (Deepseek, GLM, Minimax, Gemma) | — |
| `NVIDIA_GLM_KEY` | Específico para GLM-5.1 (fallback a NVIDIA_API_KEY) | — |
| `NVIDIA_MINIMAX_KEY` | Específico para Minimax-M2.7 (fallback a NVIDIA_API_KEY) | — |
| `NVIDIA_GEMMA_KEY` | Específico para Gemma-4 (fallback a NVIDIA_API_KEY) | — |
| `NVIDIA_QWEN_KEY` | Específico para Qwen-3.5 (requerido) | — |

## Arquitectura LLM (Router Tiered)

Wasagro implementa un **Router Multi-Modelo** (D3) que selecciona automáticamente el mejor LLM según la complejidad de la tarea:

### Tiers

| Tier | Caso de uso | Modelos | Latencia |
|---|---|---|---|
| `fast` | Clasificación, acuses, extracción simple | Gemini 2.5 Flash, Groq Llama 3.3 70b | < 1s |
| `reasoning` | Análisis multi-intento, ReAct, reflexión | Deepseek V4, GLM-5.1, Gemini 2.5 Flash | < 3s |
| `ultra` | Diagnóstico V2VK, casos críticos, multimodal | Gemini 2.5 Pro, Minimax M2.7, Gemma-4, Qwen 3.5 | < 5s |

### Configuración

- `WASAGRO_LLM=auto` activa el router con el pool completo (recomendado)
- Se construye dinámicamente según las API keys disponibles
- Fallback automático entre providers si hay rate limits o caídas

Ver los ADRs en `docs/decisions/`.
