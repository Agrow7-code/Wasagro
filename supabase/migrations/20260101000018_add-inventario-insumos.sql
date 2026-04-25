-- Estado de inventario por producto y finca
-- Se actualiza automáticamente cuando se procesa un evento de tipo insumo
CREATE TABLE IF NOT EXISTS inventario_insumos (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finca_id              TEXT NOT NULL REFERENCES fincas(finca_id),
    producto              TEXT NOT NULL,
    unidad                TEXT NOT NULL DEFAULT 'unidad',
    cantidad_disponible   NUMERIC(12,3) NOT NULL DEFAULT 0,
    cantidad_comprometida NUMERIC(12,3) NOT NULL DEFAULT 0,
    fecha_vencimiento     DATE,
    lote_fabricacion      TEXT,
    updated_at            TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (finca_id, producto)
);

CREATE INDEX idx_inventario_finca ON inventario_insumos(finca_id);

ALTER TABLE inventario_insumos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventario_by_finca" ON inventario_insumos
    FOR ALL
    USING (
        finca_id IN (
            SELECT u.finca_id FROM usuarios u WHERE u.id = auth.uid()
        )
    );

