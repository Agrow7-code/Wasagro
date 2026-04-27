import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { langfuse } from '../integrations/langfuse.js'

export class PromptManager {
  /**
   * Obtiene un prompt siempre desde el disco local.
   * Se desactivó la descarga de Langfuse para evitar usar versiones antiguas cacheadas 
   * durante el desarrollo de la nueva arquitectura.
   */
  static async getPrompt(nombre: string, fallbackPath: string, traceId?: string): Promise<string> {
    try {
      // Forzar siempre lectura local (ignorar Langfuse)
      const localContent = readFileSync(join(process.cwd(), fallbackPath), 'utf-8')
      return localContent
    } catch (fsErr) {
      throw new Error(`Error crítico: No se pudo cargar el prompt local (${fallbackPath}). Detalles: ${String(fsErr)}`)
    }
  }
}
