# Proposal: sdr-conversacional
> Change: sdr-conversacional | Phase: sdd-propose | Date: 2026-04-23

---

## Summary

Build a WhatsApp-native AI SDR for Wasagro that qualifies leads, handles objections, personalizes narratives per ICP segment, and closes with a meeting/pilot proposal — with human-in-the-loop approval in H0. Benchmarked against 11x, Artisan, AiSDR, and Jason AI. Target: autonomous qualification of exportadoras, ONGs, and farm managers, with structured deal briefs on handoff.

**Scope**: New SDR session flow in the pipeline, 2 SQL tables, 6 system prompts, 6 playbooks, and full openspec documentation.

---

## Architecture Decision Records

### DA-SDR-01: WhatsApp-only channel
**Decision**: The SDR operates exclusively via WhatsApp. No email sequences, no LinkedIn outreach, no multi-channel.
**Rationale**: WhatsApp is where our prospects already communicate with their field teams. Introducing a new channel creates friction. Our existing Evolution API infrastructure handles WhatsApp natively. The conversation feels like a peer message, not a marketing email. In H0, operational simplicity beats channel coverage.
**Rejected alternatives**:
- Email + WhatsApp: Doubles infrastructure complexity. Prospects in Ecuador/Guatemala have lower email engagement than WhatsApp.
- LinkedIn + WhatsApp: LinkedIn API requires partner status, expensive, irrelevant to agricultural operators.
**CLAUDE.md alignment**: CR6 (canal existente), D6 (Evolution API en producción).

### DA-SDR-02: Identity as "Wasagro" assistant, not a human name
**Decision**: The SDR identifies itself as "el asistente de Wasagro" or "Wasagro" — never uses a human name like "Ana" or "Carlos".
**Rationale**: P6 (transparency + consent) prohibits deception. Agricultural operators will eventually interact with the founder directly — a fake persona creates trust damage when discovered. "Asistente de Wasagro" is honest, professional, and consistent with the brand.
**Rejected alternatives**:
- Human persona (e.g. "Ana from Wasagro"): Violates P6. Risk of backlash when prospect discovers it's AI. Artisan does this, we don't.
- Completely anonymous bot: "Asistente" without brand association misses the trust-building opportunity.
**CLAUDE.md alignment**: P6 (consentimiento + transparencia), P5 (datos de la finca).

### DA-SDR-03: Human-in-the-loop for deal proposals in H0
**Decision**: For responses that include a pilot proposal or pricing information, the SDR drafts the message and sends it to the founder via WhatsApp for approval before delivery. Casual discovery questions and objection responses are sent automatically.
**Rationale**: In H0, the founder must validate every pilot proposal to ensure quality and alignment. This prevents premature commitments or incorrect pricing. The draft → approve → send cycle keeps AI quality high while maintaining human oversight on critical decisions. Aligns with P7 (no irreversible actions without approval).
**Rejected alternatives**:
- Full automation from turn 1: Too risky in H0. A wrong pilot quote damages trust with the first real prospect.
- Human approval for every message: Creates latency that kills the conversation. Casual discovery messages can be auto-sent.
**Implementation**: Founder receives: `[SDR DRAFT — APROBAR?]\n\n{draft_message}\n\nResponde *SÍ* para enviar o escribe la corrección.`
**CLAUDE.md alignment**: P7 (no acción irreversible sin aprobación), H0 validation stage.

### DA-SDR-04: Maximum 7 discovery questions per prospect lifetime
**Decision**: The SDR MUST NOT ask more than 7 total discovery questions across all sessions with a prospect. Questions are prioritized by scoring impact.
**Rationale**: P2 (max 2 clarification questions per turn) applies to field reports — for SDR discovery, the limit is higher because discovery is multi-turn by design, but we respect the principle of not exhausting the user. 7 questions is enough to fill all 6 qualification dimensions. The question log is persisted cross-session so we never repeat a question.
**Rejected alternatives**:
- 2 questions max (same as reports): Too few to qualify a lead properly. EUDR urgency alone needs multiple follow-ups.
- Unlimited questions: Kills conversion. 11x data shows response rates drop 60% after question 5.
**CLAUDE.md alignment**: P2 (principio de máximo preguntas), P3 (respeto al tiempo del usuario).

### DA-SDR-05: A/B narrative testing — "inteligencia operativa" vs "EUDR compliance"
**Decision**: Each new prospect is randomly assigned Narrative A ("inteligencia operativa de campo") or Narrative B ("cumplimiento EUDR antes del deadline"). The narrative assignment is stored in `sdr_prospectos.narrativa_asignada`. Conversion rate by narrative is tracked in LangFuse.
**Rationale**: We don't know which narrative resonates best with each ICP. Testing both narratives in H0 gives us data before H1. Jason AI demonstrates this pattern works — openings that feel personalized outperform generic messages 2x.
**Rejected alternatives**:
- Single narrative for all: Misses opportunity to learn what triggers conversion per segment.
- Manual narrative selection: Too slow, not scalable, introduces human bias.
**Tracking**: LangFuse event `sdr_narrative_assigned` with `{prospect_id, narrativa, segmento_icp}`. Conversion tracked at `sdr_meeting_scheduled` event.
**CLAUDE.md alignment**: CR3 (LLM quality measurement), D5 (LangFuse observabilidad).

### DA-SDR-06: Qualification threshold ≥65/100 triggers pilot proposal
**Decision**: When a prospect's qualification score reaches ≥65, the SDR automatically prepares a pilot proposal draft (subject to DA-SDR-03 human approval). Scores <65 continue discovery. Score <30 triggers graceful exit: "Hablamos cuando estés listo para digitalizar tu operación."
**Rationale**: Score threshold prevents wasting founder time on unqualified leads. The 65-point threshold is calibrated so that at minimum: EUDR urgency is present (>0 points), prospect has ≥10 fincas (>0 points), and either a champion or budget signal exists. A prospect who scores 65 is genuinely worth a pilot conversation.
**Score decay**: If a prospect goes silent for 14+ days after reaching 65, the score doesn't decay — context is preserved. Discovery resumes on re-contact.
**Rejected alternatives**:
- Binary qualified/unqualified: Too coarse. A prospect with 3 fincas who has explicit EUDR urgency and budget is worth pursuing; one with 50 fincas but no urgency is not.
- Manual qualification: Doesn't scale. Defeats the purpose of the SDR.
**CLAUDE.md alignment**: P7 (no action without approval), CR2 (lógica de negocio testeable).

### DA-SDR-07: Deal brief JSONB on handoff
**Decision**: When handoff is triggered, the SDR generates a structured `deal_brief` JSONB stored in `sdr_prospectos.deal_brief`. The founder receives a WhatsApp notification with a formatted summary of key fields.
**Rationale**: AiSDR demonstrates that human escalations with full structured context close 3x faster than raw chat logs. The deal brief enables the founder to enter the first call fully prepared. The JSONB structure allows downstream automation in H1 (CRM sync, contract generation).
**Deal brief schema**:
```json
{
  "nombre_contacto": "string",
  "empresa": "string",
  "segmento_icp": "exportadora|ong|gerente_finca",
  "narrativa_asignada": "A|B",
  "qualification_score": 0-100,
  "scores_por_dimension": {...},
  "fincas_en_cartera": number,
  "cultivo": "string",
  "pais": "string",
  "eudr_urgency": "alta|media|baja|ninguna",
  "objeciones_manejadas": ["string"],
  "punto_de_dolor_principal": "string",
  "compromiso_logrado": "reunión|piloto|ninguno",
  "fecha_propuesta_reunion": "ISO8601|null",
  "conversacion_resumen": "string",
  "turns_total": number,
  "questions_asked": number
}
```
**CLAUDE.md alignment**: D5 (LangFuse + observabilidad), P4 (todo loggea).

### DA-SDR-08: Cross-session account memory — no repeated questions
**Decision**: The SDR maintains a complete question-answer log per prospect in `sdr_prospectos.preguntas_realizadas` (JSONB array). Before asking any discovery question, it checks this log. It MUST NOT ask a question already answered in a previous session.
**Rationale**: 11x demonstrates this is the single most impactful SDR feature. A prospect who said "tenemos 45 fincas" in session 1 and is asked again in session 2 will disengage immediately. The log also enables score updates across sessions as new information arrives.
**Implementation**: On each SDR turn, `contexto_parcial` in `sesiones_activas` is seeded from `sdr_prospectos.preguntas_realizadas` at session start.
**CLAUDE.md alignment**: P2 (respect user's time), user experience first.

---

## Scope

### In scope
- New SDR session type in `procesarMensajeEntrante.ts` router
- `sdr_prospectos` table (extends/replaces `prospectos`)
- `sdr_interacciones` table (interaction log)
- `IWasagroLLM.atenderSDR()` method
- 6 system prompts (master + 5 overlays/specialized)
- 6 playbooks (discovery × 3, objections, scoring, narratives)
- Qualification scoring engine (6 dimensions, 0-100)
- Objection detection and response (10 objections)
- Narrative A/B assignment
- Deal brief generation
- Human-in-the-loop draft approval flow
- LangFuse tracing per SDR interaction
- Cross-session memory (preguntas_realizadas log)

### Out of scope (H0)
- Multi-channel outreach (email, LinkedIn)
- CRM sync (HubSpot, Salesforce)
- Automated follow-up sequences (scheduled re-contact)
- Pricing calculator
- Contract generation
- Dashboard for SDR performance metrics

---

## Rollback Plan

The SDR flow is gated by a new `tipo_sesion='sdr'` session type and a new code path in the routing logic. Rollback requires:
1. Revert the routing change in `procesarMensajeEntrante.ts` (unknown phones fall back to the existing `prospectos` flow)
2. No SQL migration rollback needed — `sdr_prospectos` and `sdr_interacciones` are additive tables
3. The old `prospectos` table and flow remain intact throughout

Estimated rollback time: < 5 minutes (single commit revert + deploy).

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| LLM misclassifies objection → wrong response | MEDIUM | HIGH | Objection detection uses keyword + context, not just keyword. Manual review in LangFuse. |
| Prospect receives pilot proposal before human approval | LOW | HIGH | DA-SDR-03 gate with explicit APPROVAL_REQUIRED flag before proposal message |
| Score reaches 65 on wrong segment (e.g. gatekeepers) | MEDIUM | MEDIUM | Champion dimension (15pts) acts as filter — gatekeepers score 0 on champion |
| Cross-session memory corrupted by session merge errors | LOW | MEDIUM | preguntas_realizadas is append-only; no destructive updates |
| Founder notification delayed → prospect cools off | MEDIUM | MEDIUM | Notification includes prospect phone for direct callback if needed |
