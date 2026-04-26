import { Langfuse } from 'langfuse'

const noop = { event: () => {} }
const noopTrace = () => noop

const configured = !!(process.env['LANGFUSE_SECRET_KEY'] && process.env['LANGFUSE_PUBLIC_KEY'])

export const langfuse = configured
  ? new Langfuse({
      publicKey: process.env['LANGFUSE_PUBLIC_KEY']!,
      secretKey: process.env['LANGFUSE_SECRET_KEY']!,
      baseUrl: process.env['LANGFUSE_HOST'] ?? 'https://cloud.langfuse.com',
    })
  : { trace: noopTrace, generation: noopTrace, span: noopTrace, event: noopTrace, score: noopTrace, flushAsync: async () => {} } as unknown as Langfuse
