export function injectarVariables(template: string, vars: Record<string, string>): string {
  const escaped = Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, v.replace(/\{\{/g, '«').replace(/\}\}/g, '»')]),
  )
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => escaped[key] ?? '')
}
