-- El constraint clarification_count <= 2 solo aplica al flujo de eventos (P2),
-- pero onboarding y prospecto usan la misma columna para tracking de pasos (> 2).
-- El techo de pasos está controlado en TypeScript (MAX_ONBOARDING_STEPS, MAX_PROSPECTO_STEPS).
ALTER TABLE sesiones_activas DROP CONSTRAINT sesiones_activas_clarification_count_check;
ALTER TABLE sesiones_activas ADD CONSTRAINT sesiones_activas_clarification_count_check
  CHECK (clarification_count >= 0);
