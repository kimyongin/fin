import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { portfolioToolDefinitions } from '../supabase/functions/_shared/mcp/portfolio-tools.ts'

const root = resolve('plugins/portfolio')
const read = (path) => readFileSync(path, 'utf8')

describe('Portfolio plugin delivery', () => {
  it('ships one discoverable skill and all of its task references inside the package', () => {
    const skills = readdirSync(resolve(root, 'skills')).filter((name) => existsSync(resolve(root, 'skills', name, 'SKILL.md')))
    expect(skills).toEqual(['portfolio'])
    const entry = resolve(root, 'skills/portfolio/SKILL.md')
    expect(read(entry)).toMatch(/^---\nname: portfolio\ndescription: .+\n---/)
    const queue = [entry]
    const seen = new Set()
    while (queue.length) {
      const path = queue.shift()
      if (seen.has(path)) continue
      seen.add(path)
      for (const [, link] of read(path).matchAll(/\]\(([^)]+)\)/g)) {
        if (/^[a-z]+:/i.test(link)) continue
        const target = resolve(dirname(path), link.split('#')[0])
        const local = relative(root, target)
        expect(local.startsWith(`..${sep}`) || local === '..', link).toBe(false)
        expect(existsSync(target), link).toBe(true)
        queue.push(target)
      }
    }
    const references = readdirSync(resolve(root, 'skills/portfolio/references')).filter((name) => name.endsWith('.md'))
    expect(references.length).toBeGreaterThan(0)
    for (const name of references) expect(seen.has(resolve(root, 'skills/portfolio/references', name)), name).toBe(true)
  })

  it('only refers to domain tools actually advertised by this server', () => {
    const names = new Set(portfolioToolDefinitions.map((tool) => tool.name))
    const folder = resolve(root, 'skills/portfolio/references')
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.md'))) {
      for (const [, name] of read(resolve(folder, file)).matchAll(/`((?:get|list|find|search|record|update|save|delete|create|preview|log|reconcile|transition|set|submit|connect|remove|reset|correct|sync)_[a-z_]+)`/g)) {
        expect(names.has(name), `${file}: ${name}`).toBe(true)
      }
    }
  })

  it('keeps the single existing app-backed plugin identity without a second MCP connection', () => {
    const manifest = JSON.parse(read(resolve(root, '.codex-plugin/plugin.json')))
    const apps = JSON.parse(read(resolve(root, manifest.apps)))
    expect(manifest.name).toBe('dev-6aba7f7d0ccc8191b9f51834a40e6548')
    expect(manifest.interface.displayName).toBe('Portfolio')
    expect(JSON.stringify(apps)).toContain('asdk_app_6aba7f7d0ccc8191b9f51834a40e6548')
    expect(existsSync(resolve(root, '.mcp.json')) || existsSync(resolve(root, 'mcp.json'))).toBe(false)
  })
})
