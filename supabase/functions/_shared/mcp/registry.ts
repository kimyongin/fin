import type { PortfolioToolDefinition } from './portfolio-tools.ts'

export type ToolHandler = (supabase: any, args: Record<string, unknown>) => Promise<unknown>

export function validateToolRegistry(
  definitions: PortfolioToolDefinition[],
  handlers: Record<string, ToolHandler>,
  groups: Record<string, readonly string[]>,
) {
  const definitionNames = definitions.map((definition) => definition.name).sort()
  const handlerNames = Object.keys(handlers).sort()
  if (JSON.stringify(definitionNames) !== JSON.stringify(handlerNames)) {
    throw new Error('Portfolio MCP tool definitions and handlers do not match')
  }

  const groupedNames = Object.values(groups).flat()
  const duplicates = groupedNames.filter((name, index) => groupedNames.indexOf(name) !== index)
  if (duplicates.length > 0) throw new Error(`Portfolio MCP tool groups contain duplicates: ${[...new Set(duplicates)].join(', ')}`)
  const unknown = groupedNames.filter((name) => !handlers[name])
  if (unknown.length > 0) throw new Error(`Portfolio MCP tool groups contain unknown tools: ${unknown.join(', ')}`)
  return handlers
}
