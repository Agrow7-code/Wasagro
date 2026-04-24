# Exploration: sdr-conversacional
> Change: sdr-conversacional | Phase: sdd-explore | Date: 2026-04-23

---

## Problem Statement

Wasagro has a partial prospecting system (`sp-00-prospecto.md` + `saveProspecto()`) that captures name, farm name, and crop — then waits for a human to follow up. This is a **handoff to a void**: no qualification score, no objection handling, no narrative personalization, no next-step proposal, and no cross-session memory. The SDR work is currently done 100% manually, which doesn't scale in H0 and becomes unsustainable in H1.

The goal: build an AI SDR that operates **entirely via WhatsApp**, qualifies leads using a 6-dimension score, handles objections with evidence, personalizes narratives per ICP, and completes the cycle with a meeting/pilot proposal — without human intervention until handoff.

---

## Benchmark Analysis

### 11x.ai
**What they do well**: Persistent multi-channel sequences (email + LinkedIn + WhatsApp). Auto-personalization based on LinkedIn profile scraping. Built-in CRM sync (HubSpot, Salesforce).
**Gaps for Wasagro**: Designed for SaaS in English-first markets. No WhatsApp-native flow. No agricultural domain knowledge. No EUDR-specific narratives. Pricing starts at $5K/month — not viable for H0.
**Key pattern to steal**: Multi-session account memory. 11x never asks the same question twice because it maintains a complete prospect profile across all touchpoints.

### Artisan (Ava)
**What they do well**: Single AI persona with a human-sounding name. High-volume outbound with personalized opening lines. Enrichment from 300M+ B2B contact database.
**Gaps for Wasagro**: WhatsApp is not a supported channel. English/US market focus. Contact enrichment databases have no Ecuadorian/Guatemalan agricultural exporters. Fake persona conflicts with our P6 (transparency) principle.
**Key pattern to steal**: Qualification happens conversationally — Ava weaves qualification questions into natural dialogue rather than running an interrogation.

### AiSDR
**What they do well**: Fully automated follow-up sequences with configurable delays. Objection detection via keyword matching. Human escalation with full conversation transcript.
**Gaps for Wasagro**: Email-only. No conversation state machine. Objection responses are static templates, not evidence-based. No scoring model.
**Key pattern to steal**: Human-in-the-loop escalation with full context — when handoff happens, the human gets a structured brief, not a raw chat log.

### Jason AI (Reply.io)
**What they do well**: Multi-channel sequencing with AI-generated variations. A/B testing of opening messages. CRM workflow automation.
**Gaps for Wasagro**: No WhatsApp. Multi-channel complexity is overkill for H0 where WhatsApp IS the channel. Sequence-based model doesn't handle inbound conversations well.
**Key pattern to steal**: A/B narrative testing — test "inteligencia operativa" vs "EUDR compliance" openings to see which lands better per ICP segment.

---

## Current Wasagro Prospecto System — Gap Analysis

### What exists (sp-00-prospecto.md flow)
1. Unknown phone sends message
2. System identifies as non-user
3. LLM extracts: nombre, finca_nombre, cultivo_principal, pais, tamanio_aproximado, tipo_contacto
4. Saves to `prospectos` table with `interes_demo` flag
5. Sends Calendly link or Google Meet auto-schedule
6. **END — no further AI involvement**

### Critical gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| No qualification scoring | Every prospect treated equally regardless of potential | CRITICAL |
| No objection handling | First objection ends the conversation | CRITICAL |
| No cross-session memory | Each message starts from zero | CRITICAL |
| No narrative personalization | Same message for exportadora, ONG, gerente finca | HIGH |
| No discovery questions | We don't know budget, timeline, champion, EUDR pressure | HIGH |
| No deal brief generation | Human receives raw Calendly booking, no context | HIGH |
| No follow-up mechanism | Single interaction only | MEDIUM |
| No A/B narrative testing | Can't optimize messaging | MEDIUM |

---

## ICP Analysis

### Segmento A: Exportadora
**Profile**: Empresa con cartera de 30+ fincas proveedoras. Presiona a los productores a adoptar trazabilidad. Gerente de operaciones o sostenibilidad como decision maker. Ecuador (cacao) o Guatemala (banano/café).
**EUDR pressure**: ALTA. El Reglamento de la UE obliga a presentar declaraciones de diligencia debida desde Q4 2025. Sin trazabilidad, pierden acceso al mercado europeo.
**Buying trigger**: Deadline EUDR + necesidad de demostrar due diligence a compradores europeos.
**Budget signal**: Manejan contratos de exportación de 6+ cifras. Presupuesto de sostenibilidad/compliance existe pero no está comprometido.
**Champion**: Gerente de sostenibilidad, jefe de operaciones de campo, o directivo de certificación.
**Ideal proof point**: "Exportadora X tiene trazabilidad de 47 fincas en 8 semanas" (velocidad de implementación).

### Segmento B: ONG / Programa de Asistencia
**Profile**: Organización con programa activo de asistencia a agricultores (GIZ, IDB Lab, USAID, Root Capital, GSMA, Rainforest Alliance). 100+ agricultores en el programa. Financia herramientas tecnológicas con fondos de grants.
**EUDR pressure**: MEDIA. Algunos programas se alinean a EUDR como entregable de su grant. Otros tienen sus propios marcos de trazabilidad.
**Buying trigger**: Grant activo con línea de "digital tools" o "capacity building". Necesidad de demostrar impacto a donante.
**Budget signal**: Grant funding disponible. Ciclos de compra lentos (3-6 meses) pero predecibles.
**Champion**: Coordinador de programa, especialista M&E, o director de proyectos.
**Ideal proof point**: "En 6 semanas, agricultores sin smartphone registran eventos de campo via WhatsApp en voz" (accesibilidad + adopción).

### Segmento C: Gerente de Finca Mediana
**Profile**: Individuo propietario o gerente de 20-200 ha. Cacao o banano. 5-15 trabajadores. Quiere exportar directamente o mejorar precio en exportadora. Ecuador o Guatemala.
**EUDR pressure**: BAJA-MEDIA. Sabe que la exportadora le pide papeles pero no conecta todavía con la urgencia regulatoria.
**Buying trigger**: Quiere dejar de perder datos de campo en libretas/WhatsApp informal. O la exportadora le exige registros.
**Budget signal**: Capaz de $50-200/mes si ve valor claro. Muy sensible al precio.
**Champion**: El mismo (owner/decision maker).
**Ideal proof point**: "En 3 días, tus trabajadores envían reportes de campo por WhatsApp y tú tienes un dashboard" (velocidad + simplicidad).

---

## Wasagro's Distinctive SDR Advantages

1. **WhatsApp-native**: Our SDR IS on WhatsApp — where our prospects already communicate with their field teams. No new app, no new context switch.
2. **Domain depth**: Agricultural vocabulary, EUDR specific knowledge, Ecuador/Guatemala market understanding — no generic SaaS SDR has this.
3. **Existing platform proof**: We can demo with a real working account during the sales conversation.
4. **Founder-led in H0**: The founder reviews every deal brief before responding — this is a feature, not a bug. Personalized attention at the top.
5. **EUDR clock is ticking**: The regulatory urgency creates a natural closing mechanism that other software categories lack.

---

## H0 Constraints

- Human-in-the-loop (H0): SDR drafts responses, founder approves before sending (for responses >3 turns)
- No email or LinkedIn — WhatsApp only
- Max 7 discovery questions per prospect per session
- No fabricated reference cases or statistics (SDR-G1)
- No H1/H2 feature promises (SDR-G2)
- No artificial urgency tactics (SDR-G4)

---

## Technical Anchors (existing infrastructure to reuse)

- `sesiones_activas` table — extend for SDR sessions with `tipo_sesion='sdr'`
- `prospectos` table — extend with qualification score fields
- `IWasagroLLM` interface — add `atenderSDR()` method
- LangFuse tracing — per-interaction spans already established
- Evolution API sender — outbound message infrastructure ready
- `procesarMensajeEntrante.ts` — routing to SDR flow for unregistered phones
