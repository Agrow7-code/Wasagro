import OpenAI from 'openai'

export const openai = new OpenAI({ apiKey: process.env['OPENAI_API_KEY'] })

export const LLM_MODEL = process.env['OPENAI_LLM_MODEL'] ?? 'gpt-4o-mini'
export const STT_MODEL = process.env['OPENAI_STT_MODEL'] ?? 'gpt-4o-mini-transcribe'
