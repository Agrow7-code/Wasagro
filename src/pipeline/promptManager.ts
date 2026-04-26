import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { langfuse } from '../integrations/langfuse.js'

export class PromptManager {
  /**
   * Obtiene un prompt desde Langfuse, con fallback a disco local.
   * @param nombre El nombre del prompt (ej. 'sp-00-clasificador')
   * @param fallbackPath La ruta relativa a la raíz del proyecto para leer el archivo si Langfuse falla (ej. 'prompts/sp-00-clasificador.md')
   * @param traceId Opcional, el ID del trace actual para registrar el uso del fallback.
   * @returns El contenido del prompt en formato string.
   */
  static async getPrompt(nombre: string, fallbackPath: string, traceId?: string): Promise<string> {
    try {
      // 1. Intentamos obtener el prompt desde Langfuse (usa caché interna automáticamente)
      const prompt = await langfuse.getPrompt(nombre)
      return prompt.getLangchainPrompt() as string // o dependendiendo de cómo guardemos el texto en Langfuse
    } catch (err) {
      // 2. Si falla (timeout, no existe en Langfuse, no hay keys), usamos el fallback local
      try {
        const localContent = readFileSync(join(process.cwd(), fallbackPath), 'utf-8')
        
        // Registrar en Langfuse que usamos el fallback local si tenemos el traceId
        if (traceId) {
          langfuse.trace({ id: traceId }).event({
            name: 'prompt_fallback_used',
            metadata: { 
              promptSource: 'local-fallback', 
              promptName: nombre,
              error: err instanceof Error ? err.message : String(err)
            }
          })
        } else {
          console.warn(`[PromptManager] Fallback local usado para: ${nombre} (sin traceId)`)
        }

        return localContent
      } catch (fsErr) {
        throw new Error(`Error crítico: No se pudo cargar el prompt '${nombre}' desde Langfuse ni desde local (${fallbackPath}).`)
      }
    }
  }
}
