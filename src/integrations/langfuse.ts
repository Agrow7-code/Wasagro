/**
 * Langfuse Bypass - Desactivado por caída de instancia en Railway
 */
const noop = () => ({ 
  event: () => noop(), 
  generation: () => noop(), 
  span: () => noop(), 
  score: () => {}, 
  end: () => {} 
});

export const langfuse = {
  trace: () => ({
    event: () => noop(),
    generation: () => noop(),
    span: () => noop(),
    score: () => {},
    id: 'bypassed'
  }),
  generation: () => noop(),
  span: () => noop(),
  event: () => noop(),
  score: () => {},
  flushAsync: async () => {},
} as any;
