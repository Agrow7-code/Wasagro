# Design: Agente Orquestador con Mini-Agentes

## Technical Approach

Reemplazar el pipeline rígido (clasificador → extractor → handler) con una arquitectura de **Agente Orquestador** que coordina mini-agentes especializados. El orquestador mantiene estado conversacional y decide qué mini-agente invocar según la intención detectada.

## Architecture Decisions

| Decision | Options | Tradeoffs | Choice |
|----------|---------|-----------|--------|
| Arquitectura | Monolítica secuencial vs Agente Orquestador | Monolítica: simple pero rígida. Orquestador: complejidad mayor pero extensible y testeable | Agente Orquestador |
| Detección de intención | Regex + keywords vs LLM dedicado | Regex: rápido pero frágil. LLM: robusto, maneja variaciones naturales | LLM dedicado (mini-agente) |
| Múltiples LLMs | Single provider vs Multi-provider fallback | Single: simple. Multi: resiliencia, permite benchmarking | Multi-provider con fallback |
| Estado conversacional | Handler state vs Orquestador state | Handler: disperso. Orquestador: centralizado, debuggable | Orquestador state |

## Data Flow

```
Mensaje agricultor
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Agente Orquestador (mantiene contexto conversacional)  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │Intención     │  │Extracción    │  │Validación    │  │
│  │Detector      │  │Especializada │  │& Confirmación│  │
│  │              │  │              │  │              │  │
│  │- ¿Corrección?│  │- Forzar tipo │  │- ¿Completo?  │  │
│  │- ¿Nuevo?     │  │  posible     │  │- ¿Faltan     │  │
│  │- ¿Consulta?  │  │- Extraer     │  │  campos?     │  │
│  └──────────────┘  │  campos     │  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
       │
       ▼
  ┌────────────────────────────────────────┐
  │  Router de LLM (con fallback strategy) │
  │  1. Intentar modelo principal          │
  │  2. Si falla/lento → fallback          │
  │  3. Registrar métricas en LangFuse     │
  └────────────────────────────────────────┘
       │
       ▼
  Persistencia (eventos_campo)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/integrations/llm/OrchestratorAgent.ts` | Create | Agente principal que coordina mini-agentes |
| `src/integrations/llm/mini-agents/IntentionDetector.ts` | Create | Detecta intención: nuevo_evento, corregir_tipo, completar_datos, consulta |
| `src/integrations/llm/mini-agents/ExtractionAgent.ts` | Create | Extrae campos con tipo forzable opcional |
| `src/integrations/llm/mini-agents/ValidationAgent.ts` | Create | Valida completitud y sugiere preguntas |
| `src/integrations/llm/LLMRouter.ts` | Create | Selecciona proveedor con fallback |
| `src/integrations/llm/ProviderBenchmark.ts` | Create | Métricas de latencia/confiabilidad por provider |
| `src/integrations/llm/WasagroAIAgent.ts` | Modify | Refactorizar para usar orquestador |
| `src/pipeline/handlers/EventHandler.ts` | Modify | Simplificar, delegar a orquestador |
| `prompts/sp-00-intencion-detector.md` | Create | Prompt para detector de intención |
| `prompts/sp-XX-extractor-unificado.md` | Create | Prompt unificado con soporte forzar_tipo |

## Interfaces / Contracts

```typescript
// Estado del orquestador (H0-compliant: estructura de datos)
interface OrquestadorState {
  session_id: string
  conversation_stage: 'initial' | 'awaiting_clarification' | 'awaiting_confirmation' | 'correction_mode'
  extracted_event: EventoCampoExtraido | null
  user_intention: IntencionUsuario | null
  correction_history: CorrectionAttempt[]
  llm_provider_used: string
  latency_ms: number
}

type IntencionUsuario = 
  | { tipo: 'nuevo_evento' }
  | { tipo: 'corregir_tipo'; tipo_sugerido: string }
  | { tipo: 'completar_datos'; campos_faltantes: string[] }
  | { tipo: 'confirmar' }
  | { tipo: 'rechazar' }
  | { tipo: 'consulta' }

interface CorrectionAttempt {
  timestamp: string
  campo: string
  valor_anterior: unknown
  valor_nuevo: unknown
  intento_numero: number
}

// Router de LLM (H0-compliant: estructura de datos)
interface LLMRouterConfig {
  primary: LLMProviderConfig
  fallbacks: LLMProviderConfig[]
  strategy: 'latency' | 'cost' | 'quality'
  timeout_ms: number
}

interface LLMProviderConfig {
  provider: 'groq' | 'gemini' | 'deepseek' | 'glm' | 'minimax' | 'qwen'
  model: string
  api_key_env: string
  priority: number
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | IntentionDetector | Casos de intención explícita vs implícita |
| Unit | LLMRouter | Fallback cuando primary falla |
| Integration | Mini-agentes | Flujo completo con cada provider |
| E2E | Conversaciones reales | Simular corrección de tipo bucle |

## Migration / Rollout

1. **Fase 1**: Crear mini-agentes paralelos, no reemplazar existente
2. **Fase 2**: Feature flag `USE_ORCHESTRATOR` para probar con usuarios beta
3. **Fase 3**: Benchmark: comparar precisión/latencia vs sistema actual
4. **Fase 4**: Migración completa si benchmark favorable

## Open Questions

- [ ] ¿Cuál es el timeout adecuado para fallback? (proponer 3s)
- [ ] ¿Se necesita rate limiting por provider?
- [ ] ¿Cómo manejar costos si un provider es más caro?
