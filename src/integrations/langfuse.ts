export const langfuse = {
  trace: () => ({
    event: () => ({ end: () => {} }),
    generation: () => ({ end: () => {} }),
    span: () => ({ end: () => {} }),
    score: () => {},
  }),
  generation: () => ({ end: () => {} }),
  span: () => ({ end: () => {} }),
  event: () => ({ end: () => {} }),
  score: () => {},
  flushAsync: async () => {},
} as any
