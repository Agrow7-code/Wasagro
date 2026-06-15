-- Tabla de feedback: captura las correcciones humanas sobre celdas de muestreos
-- de Sigatoka. Fuente del flywheel de evaluación de prompts (CR5).
-- Registra valor/estado previo (extraído) y valor corregido para comparar accuracy.
-- No es transaccional con el PATCH: un insert fallido nunca debe tumbar la corrección
-- del evento (P4). El consumidor de evals se construye en una fase posterior.

create table sigatoka_correcciones (
  id              uuid        not null default gen_random_uuid(),
  -- FK con cascade: si se elimina el evento, sus correcciones desaparecen con él.
  evento_id       uuid        not null references eventos_campo(id) on delete cascade,
  finca_id        text        not null,
  -- Identificador del punto/fila: ej. "P3", "11sem-14"
  punto           text        not null,
  -- Campo de la celda corregida: ej. "ht", "planta1_estadio"
  campo           text        not null,
  -- Valor y estado que el modelo extrajo originalmente (null = no había valor / ilegible)
  valor_extraido  numeric     null,
  estado_extraido text        null,
  -- Valor que el humano ingresó como correcto
  valor_corregido numeric     null,
  -- Quién corrigió: 'asesor_ui' (UI D28) o 'tomador_whatsapp' (follow-up WhatsApp)
  fuente          text        not null,
  -- Usuario autenticado que realizó la corrección (null para tomador WhatsApp)
  creado_por      uuid        null,
  created_at      timestamptz not null default now(),

  constraint sigatoka_correcciones_pkey primary key (id),
  constraint sigatoka_correcciones_fuente_check check (fuente in ('asesor_ui', 'tomador_whatsapp'))
);

-- Búsqueda por evento (frecuente: cargar correcciones de un muestreo)
create index idx_sigatoka_correcciones_evento_id
  on sigatoka_correcciones (evento_id);

-- Búsqueda por finca + fecha (análisis de accuracy por finca, flywheel evals)
create index idx_sigatoka_correcciones_finca_created
  on sigatoka_correcciones (finca_id, created_at desc);

-- RLS: solo el service role del backend escribe y lee esta tabla.
-- No se expone a usuarios autenticados vía JWT de Supabase — el PATCH de D30
-- pasa por el backend Hono que usa la clave de service role. Este patrón es
-- consistente con las demás tablas de flywheel/evals del repo (sdr_prospectos,
-- sdr_interacciones, llm_call_costs).
alter table sigatoka_correcciones enable row level security;

create policy sigatoka_correcciones_service_only
on sigatoka_correcciones
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
