-- Plan de cuentas personalizable por organización
-- Permite vincular gastos y ventas a categorías contables para P&L por cultivo
CREATE TABLE IF NOT EXISTS plan_de_cuentas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      TEXT NOT NULL,
    codigo      TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    tipo        TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso', 'activo', 'pasivo', 'costo')),
    cultivo     TEXT,           -- null = aplica a todos los cultivos de la org
    activa      BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (org_id, codigo)
);

CREATE INDEX idx_cuentas_org ON plan_de_cuentas(org_id);

-- Cuentas base para nuevas organizaciones (INSERT genérico por org se hace desde la app)
-- Ejemplo de estructura recomendada:
-- 4000 Ingresos por Venta (ingreso)
-- 4100 Venta Cacao (ingreso, cultivo=cacao)
-- 4200 Venta Banano (ingreso, cultivo=banano)
-- 5000 Costos de Producción (egreso)
-- 5100 Insumos y Agroquímicos (egreso)
-- 5200 Mano de Obra (egreso)
-- 5300 Transporte y Flete (egreso)
-- 6000 Gastos Administrativos (egreso)
