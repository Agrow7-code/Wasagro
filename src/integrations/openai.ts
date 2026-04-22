import OpenAI from 'openai'

export const openai: OpenAI | null = process.env['OPENAI_API_KEY']
  ? new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })
  : null

export const LLM_MODEL = process.env['OPENAI_LLM_MODEL'] ?? 'gpt-4o-mini'
export const STT_MODEL = process.env['OPENAI_STT_MODEL'] ?? 'gpt-4o-mini-transcribe'
