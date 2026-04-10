# LangFuse Self-Hosted — Wasagro H0

LangFuse provee trazabilidad completa de cada llamada LLM y STT del pipeline. Es **no negociable antes de W3** (usuarios reales) per R4 de AGENTS.md.

## Prerequisitos

- Docker y Docker Compose instalados
- Acceso al Supabase project (connection string)
- Puerto 3000 disponible en el servidor

## Paso 1 — Preparar variables de entorno

```bash
cd infrastructure/langfuse
cp .env.example .env
```

Editar `.env` con los valores reales:

1. **`DATABASE_URL`** — obtener en Supabase Dashboard:
   - Ir a: Settings → Database → Connection string
   - Seleccionar: **URI** (no Transaction pooler)
   - Puerto: **5432** (directo, no pooler 6543)
   - Agregar al final: `?schema=langfuse`
   - Ejemplo: `postgresql://postgres.abcdef:[password]@aws-0-us-east-1.pooler.supabase.com:5432/postgres?schema=langfuse`

2. **`NEXTAUTH_SECRET`** y **`SALT`** — generar valores aleatorios:
   ```bash
   openssl rand -base64 32   # correr dos veces, uno para cada variable
   ```

3. **`LANGFUSE_HOST`** — URL donde será accesible LangFuse:
   - Local: `http://localhost:3000`
   - Producción: `https://langfuse.tu-dominio.com`

## Paso 2 — Levantar LangFuse

```bash
cd infrastructure/langfuse
docker-compose up -d
```

Verificar que está corriendo:
```bash
docker-compose ps
docker-compose logs langfuse-server --tail=50
```

Esperar hasta ver: `Ready on http://0.0.0.0:3000`

## Paso 3 — Primer login y configurar proyecto

1. Abrir `http://localhost:3000` (o tu URL)
2. Crear cuenta de admin (primer usuario)
3. Crear organización: **Wasagro**
4. Crear proyecto: **wasagro-h0**

## Paso 4 — Generar API Keys

En la UI de LangFuse:
1. Ir a **Settings → API Keys**
2. Click **Create new key**
3. Copiar:
   - `Public Key` → `pk-lf-...`
   - `Secret Key` → `sk-lf-...`
4. Pegar en `.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   ```
5. Reiniciar el servicio: `docker-compose restart`

## Paso 5 — Configurar en n8n

En n8n, agregar como variables de entorno o credentials:

```
LANGFUSE_PUBLIC_KEY = pk-lf-...
LANGFUSE_SECRET_KEY = sk-lf-...
LANGFUSE_HOST       = http://localhost:3000
```

O usar el nodo HTTP de n8n con base URL configurada.

## Paso 6 — Verificar funcionamiento

Enviar una traza de prueba (desde cualquier terminal con curl):

```bash
curl -X POST http://localhost:3000/api/public/ingestion \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'pk-lf-TU_KEY:sk-lf-TU_KEY' | base64)" \
  -d '{
    "batch": [{
      "id": "test-trace-001",
      "type": "trace-create",
      "body": {
        "id": "test-trace-001",
        "name": "wasagro_test",
        "metadata": {"env": "test"}
      },
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }]
  }'
```

Verificar en la UI: **Traces → wasagro_test** debe aparecer.

## Condición de éxito (antes de W3)

- [ ] LangFuse corre y es accesible
- [ ] Proyecto `wasagro-h0` creado
- [ ] API keys generadas y configuradas en n8n
- [ ] Traza de prueba visible en la UI
- [ ] `v_pipeline_health` en Supabase muestra filas (cuando el pipeline corra)

## Troubleshooting

**Error: `connection refused` a Supabase**
- Verificar que `DATABASE_URL` usa puerto 5432, no 6543
- Verificar que el proyecto de Supabase no tiene restricciones de IP

**Error: `schema langfuse does not exist`**
- LangFuse crea el schema automáticamente. Si falla: `CREATE SCHEMA langfuse;` en Supabase SQL editor.

**Error: `NEXTAUTH_SECRET` inválido**
- Debe ser al menos 32 caracteres. Regenerar con `openssl rand -base64 32`.

## Migración futura

Revisar cuando: volumen > 50K trazas/mes o Postgres compartido se sature.
Alternativa: LangFuse Cloud (free tier 50K trazas/mes, sin infra propia).
