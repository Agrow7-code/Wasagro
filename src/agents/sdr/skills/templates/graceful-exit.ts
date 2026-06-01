// Sent when the prospect declines (intent = 'declined'). Leaves the door
// open without insisting. Wasagro principle: never argue with a 'no', but
// also never burn the bridge.

export function gracefulExit(_: { ctx?: unknown; vars?: unknown }): string {
  return 'Entiendo, no hay problema. Si en algún momento quieres simplificar tu operación agrícola, aquí estaremos. ¡Un saludo! 👋'
}
