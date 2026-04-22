# 002 — Evolution API sobre Meta Cloud API directo

**Fecha:** 2026-04-22
**Estado:** Aceptada

## Contexto

D6 original establecía Meta Cloud API directo como el canal de H0. Durante el setup de producción, el equipo no pudo obtener acceso al Meta Developer Portal (verificación de empresa pendiente). Iniciar validación de H0 requería un canal de WhatsApp funcional inmediatamente.

## Decisión

Usar Evolution API self-hosted (open-source, Baileys-based) en Railway como canal de H0. El código implementa `IWhatsAppAdapter` e `IWhatsAppSender` como interfaces, con `EvolutionAdapter` y `EvolutionSender` como implementaciones concretas. `MetaAdapter` y `MetaSender` existen como implementaciones alternativas listas para H1.

## Consecuencias

**Ganado:**
- Canal funcional en H0 sin bloqueo por verificación de Meta.
- La abstracción `IWhatsAppAdapter` / `IWhatsAppSender` permite migrar a Meta en H1 con un cambio de variable de entorno (`WHATSAPP_PROVIDER=meta`).
- Costo $0 adicional en H0 (corre en el mismo proyecto Railway).

**Perdido:**
- Evolution API usa Baileys (cliente no oficial) — riesgo de baneos de número en producción si el volumen es alto o si Meta detecta el patrón.
- No soporta templates de WhatsApp Business en H0 (solo mensajes dentro de ventana 24h).
- Al migrar a Meta en H1, se necesitará verificar el número y registrarlo en WABA.

**Condición de revisión:**
Cuando Meta Developer esté accesible, migrar a `MetaAdapter` + `MetaSender` cambiando `WHATSAPP_PROVIDER=meta` y configurando `META_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`.
