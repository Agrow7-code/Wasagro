import { Langfuse } from 'langfuse'

const noop = () => ({
  event: () => noop(),
  generation: () => noop(),
  span: () => noop(),
  score: () => {},
  end: () => {},
  id: 'noop',
})

const configured = !!(process.env['LANGFUSE_SECRET_KEY'] && process.env['LANGFUSE_PUBLIC_KEY'])

export const langfuse: Langfuse = configured
  ? new Langfuse({
      publicKey: process.env['LANGFUSE_PUBLIC_KEY']!,
      secretKey: process.env['LANGFUSE_SECRET_KEY']!,
      baseUrl: process.env['LANGFUSE_HOST'] ?? 'https://cloud.langfuse.com',
    })
  : ({
      trace: () => noop(),
      generation: () => noop(),
      span: () => noop(),
      event: () => noop(),
      score: () => {},
      flushAsync: async () => {},
    } as unknown as Langfuse)
