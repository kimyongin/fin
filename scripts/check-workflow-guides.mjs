import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { portfolioToolDefinitions } from '../supabase/functions/_shared/mcp/portfolio-tools.ts'
import { validateWorkflowGuides, workflowGuides, workflowGuideTopics } from '../supabase/functions/_shared/mcp/workflow-guides.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(repoRoot, 'docs/design/contracts/agent/workflow-guide-review.json')
const guideSourcePath = 'supabase/functions/_shared/mcp/workflow-guides.ts'

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizedFile(path) {
  const absolute = resolve(repoRoot, path)
  if (!existsSync(absolute)) throw new Error(`Workflow guide source path does not exist: ${path}`)
  return readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n')
}

const toolNames = portfolioToolDefinitions.map((definition) => definition.name)
validateWorkflowGuides(toolNames)

const expectedTopics = Object.fromEntries(workflowGuideTopics.map((topic) => {
  const guide = workflowGuides[topic]
  const toolDefinitions = guide.related_tools.map((name) => {
    const definition = portfolioToolDefinitions.find((item) => item.name === name)
    if (!definition) throw new Error(`${topic} references missing tool definition: ${name}`)
    return definition
  })
  const sourceFiles = [...new Set([guideSourcePath, ...guide.source_paths])]
    .sort()
    .map((path) => ({ path, sha256: sha256(normalizedFile(path)) }))
  return [topic, {
    revision: guide.revision,
    contract_digest: sha256(JSON.stringify({ guide, toolDefinitions, sourceFiles })),
  }]
}))

const update = process.argv.includes('--update')
if (update) {
  const reason = String(process.env.WORKFLOW_GUIDE_REVIEW_REASON ?? '').trim()
  if (!reason) throw new Error('Set WORKFLOW_GUIDE_REVIEW_REASON before updating the workflow guide review manifest.')
  const manifest = {
    schema_version: 1,
    reviewed_at: new Date().toISOString().slice(0, 10),
    review_reason: reason,
    topics: expectedTopics,
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  console.log(`Updated ${relative(repoRoot, manifestPath)} for ${workflowGuideTopics.length} topics.`)
  process.exit(0)
}

if (!existsSync(manifestPath)) throw new Error('Workflow guide review manifest is missing. Run npm run update:workflow-guide-review with a review reason.')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (manifest.schema_version !== 1 || !manifest.review_reason || !manifest.reviewed_at) {
  throw new Error('Workflow guide review manifest needs schema_version, reviewed_at, and review_reason.')
}
if (JSON.stringify(manifest.topics) !== JSON.stringify(expectedTopics)) {
  const changed = workflowGuideTopics.filter((topic) => JSON.stringify(manifest.topics?.[topic]) !== JSON.stringify(expectedTopics[topic]))
  const removed = Object.keys(manifest.topics ?? {}).filter((topic) => !workflowGuideTopics.includes(topic))
  throw new Error([
    `Workflow guide contracts changed without a recorded review: ${[...changed, ...removed].join(', ') || 'unknown topic'}.`,
    'Update the relevant guide or record why the behavior remains correct, then run:',
    'WORKFLOW_GUIDE_REVIEW_REASON="..." npm run update:workflow-guide-review',
  ].join('\n'))
}

console.log(`Workflow guide registry and reviewed contracts are current for ${workflowGuideTopics.length} topics.`)
