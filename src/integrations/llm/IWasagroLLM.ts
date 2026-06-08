import type { EntradaEvento, ExtraccionMultiEvento, ResultadoIntentGate } from '../../types/dominio/EventoCampo.js'
import type { ContextoConversacion, ContextoOnboardingAgricultor, RespuestaOnboarding } from '../../types/dominio/Onboarding.js'
import type { ResumenSemanal, EntradaResumenSemanal } from '../../types/dominio/Resumen.js'
import type { ExtraccionSDR } from '../../types/dominio/SDRTypes.js'
import type { ClasificacionExcel, EntradaClasificacionExcel } from '../../types/dominio/Excel.js'
import type { DiagnosticoV2VK } from '../../types/dominio/Vision.js'
import type { ResultadoOCR } from '../../types/dominio/OCR.js'
import type { SigatokaMuestreo } from '../../types/dominio/SigatokaMuestreo.js'

// Re-exportar tipos para uso en otros módulos
export type { ResultadoOCR } from '../../types/dominio/OCR.js'
export type { SigatokaMuestreo } from '../../types/dominio/SigatokaMuestreo.js'

export type TipoImagen = 'plaga_cultivo' | 'documento_tabla' | 'muestreo_sigatoka_banano' | 'otro'

export interface ContextoOCR {
  finca_nombre?: string | undefined
  cultivo_principal?: string | undefined
  lista_lotes?: string | undefined
}

export interface CostContext {
  orgId: string
  // Explicit `| undefined` so call sites under `exactOptionalPropertyTypes: true`
  // can pass `fincaId: usuario.finca_id ?? undefined` without conditional spreads.
  fincaId?: string | undefined
}

export interface IWasagroLLM {
  clasificarIntenciones(input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<ResultadoIntentGate>
  extraerEventos(input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<ExtraccionMultiEvento>
  corregirTranscripcion(raw: string, traceId: string, costCtx?: CostContext): Promise<string>
  describirImagenVisual(imageUrl: string, traceId: string, costCtx?: CostContext): Promise<string>
  diagnosticarSintomaV2VK(descripcionVisual: string, contextoRAG: string, input: EntradaEvento, traceId: string, costCtx?: CostContext): Promise<DiagnosticoV2VK>
  clasificarTipoImagen(base64: string, mimeType: string, traceId: string, caption?: string, costCtx?: CostContext): Promise<TipoImagen>
  extraerDocumentoOCR(base64: string, mimeType: string, contexto: ContextoOCR, traceId: string, costCtx?: CostContext): Promise<ResultadoOCR>
  extraerMuestreoSigatoka(base64: string, mimeType: string, traceId: string, costCtx?: CostContext): Promise<SigatokaMuestreo>
  onboardarAdmin(mensaje: string, contexto: ContextoConversacion, traceId: string, costCtx?: CostContext): Promise<RespuestaOnboarding>
  onboardarAgricultor(mensaje: string, contexto: ContextoOnboardingAgricultor, traceId: string, costCtx?: CostContext): Promise<RespuestaOnboarding>
  resumirSemana(entrada: EntradaResumenSemanal, traceId: string, costCtx?: CostContext): Promise<ResumenSemanal>
  extraerDatosSDR(texto: string, contextoActual: string, traceId: string, costCtx?: CostContext): Promise<ExtraccionSDR>
  redactarMensajeSDR(mensajeUsuario: string, contextoActual: string, directiva: string, traceId: string, costCtx?: CostContext): Promise<string>
  clasificarIntencionSDR(texto: string, opciones: readonly string[], contexto: string, traceId: string, costCtx?: CostContext): Promise<string>
  clasificarExcel(entrada: EntradaClasificacionExcel, traceId: string, costCtx?: CostContext): Promise<ClasificacionExcel>
}
