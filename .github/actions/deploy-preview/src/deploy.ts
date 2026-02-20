import * as core from '@actions/core'
import * as github from '@actions/github'
import { diffLines } from 'diff'
import * as yaml from 'js-yaml'
import { endGroup, postOrUpdatePrComment, startGroup, writeSummary } from './gha'
import { ActionInputs, PreviewValues, ServiceEntry, ServiceMetadata } from './types'

const MAX_RETRIES = 3

export function slugify(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function buildServiceMetadata(inputs: ActionInputs): ServiceMetadata {
  return {
    'pr-author': inputs.prAuthor,
    'pr-url': inputs.prUrl,
    'pr-number': inputs.prNumber,
    'created-at': inputs.timestamp,
    'updated-at': inputs.timestamp,
    'vcs.ref.name': inputs.headRef,
    'cicd.pipeline.run.url': inputs.workflowRunUrl,
  }
}

export function buildPreviewValues(
  slug: string,
  serviceName: string,
  commitSha: string,
  catalog: string[],
  inputs: ActionInputs,
): PreviewValues {
  const services: ServiceEntry[] = catalog.map((name) => {
    const entry: ServiceEntry = { name }
    if (name === serviceName) {
      entry.commitSha = commitSha
      entry.metadata = buildServiceMetadata(inputs)
    }
    return entry
  })
  return { services }
}

export function updatePreviewValues(
  existing: PreviewValues,
  serviceName: string,
  commitSha: string,
  inputs: ActionInputs,
): PreviewValues {
  const svc = existing.services.find((s) => s.name === serviceName)
  if (svc) {
    const existingCreatedAt = svc.metadata?.['created-at'] ?? ''
    const metadata = buildServiceMetadata(inputs)
    if (existingCreatedAt) {
      metadata['created-at'] = existingCreatedAt
    }
    svc.commitSha = commitSha
    svc.metadata = metadata
  } else {
    existing.services.push({
      name: serviceName,
      commitSha,
      metadata: buildServiceMetadata(inputs),
    })
  }
  return existing
}

export function buildSummary(
  slug: string,
  config: PreviewValues,
  commitMessage: string,
  commitUrl: string,
): string {
  const lines: string[] = [`## Preview: \`${slug}\``, '']
  lines.push('| Service | Status | Ref |')
  lines.push('|---------|--------|-----|')
  for (const svc of config.services) {
    const sha = svc.commitSha
    const prUrl = svc.metadata?.['pr-url'] ?? ''
    const prNumber = svc.metadata?.['pr-number'] ?? ''
    let status: string
    let ref: string
    if (sha) {
      const shaShort = sha.length >= 8 ? sha.slice(0, 8) : sha
      ref = prUrl ? `[PR #${prNumber}](${prUrl})` : '—'
      status = `📌 ${shaShort}`
    } else {
      status = '🔄 tracking main'
      ref = '—'
    }
    lines.push(`| ${svc.name} | ${status} | ${ref} |`)
  }
  lines.push('')
  lines.push(`**Gitops commit:** [${commitMessage}](${commitUrl})`)
  return lines.join('\n')
}

function dumpYaml(config: PreviewValues): string {
  return yaml.dump(config, { lineWidth: -1, sortKeys: false })
}

function logDiff(oldContent: string, newContent: string): void {
  if (oldContent === newContent) {
    core.info('(no changes)')
    return
  }
  for (const change of diffLines(oldContent, newContent)) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    if (change.added) {
      for (const line of lines) core.info(`\x1b[32m+ ${line}\x1b[0m`)
    } else if (change.removed) {
      for (const line of lines) core.info(`\x1b[31m- ${line}\x1b[0m`)
    } else {
      for (const line of lines) core.info(`\x1b[90m  ${line}\x1b[0m`)
    }
  }
}

export async function main(inputs: ActionInputs): Promise<void> {
  const { gitopsRepo, gitopsToken, serviceName, headRef, commitSha } = inputs

  if (!gitopsRepo || !gitopsRepo.includes('/')) {
    throw new Error("GITOPS_REPO must be set in 'owner/repo' format.")
  }

  const [owner, repo] = gitopsRepo.split('/', 2)
  const octokit = github.getOctokit(gitopsToken)

  // Fetch service catalog from services.yaml
  startGroup('Fetching services.yaml')
  let catalog: string[]
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: 'services.yaml' })
    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error('services.yaml is not a file')
    }
    const raw = Buffer.from(data.content, 'base64').toString('utf-8')
    core.debug(raw)
    const parsed = yaml.load(raw)
    if (typeof parsed !== 'object' || parsed === null || !('serviceRepos' in parsed)) {
      throw new Error("services.yaml missing 'serviceRepos' key")
    }
    catalog = Object.keys((parsed as { serviceRepos: Record<string, unknown> }).serviceRepos)
    core.info(`Catalog: ${catalog.join(', ')}`)
  } catch (e) {
    endGroup()
    if ((e as { status?: number }).status === 404) {
      throw new Error(`services.yaml not found in ${gitopsRepo}`, { cause: e })
    }
    throw e
  }
  endGroup()

  if (!catalog.includes(serviceName)) {
    throw new Error(
      `Service '${serviceName}' not found in services.yaml. Available: ${catalog.join(', ')}`,
    )
  }

  const slug = slugify(headRef)
  core.info(`Branch: ${headRef} -> Slug: ${slug}`)

  const filePath = `previews/${slug}/values.yaml`
  let exists = false
  let fileSha: string | undefined
  let config: PreviewValues
  let oldContent: string | undefined

  // Try to get existing file
  startGroup(`Current state: ${filePath}`)
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath })
    if (Array.isArray(data) || data.type !== 'file') throw new Error('Not a file')
    exists = true
    fileSha = data.sha
    oldContent = Buffer.from(data.content, 'base64').toString('utf-8')
    core.debug(oldContent)
    config = updatePreviewValues(
      yaml.load(oldContent) as PreviewValues,
      serviceName,
      commitSha,
      inputs,
    )
  } catch (e) {
    if ((e as { status?: number }).status !== 404) {
      endGroup()
      throw e
    }
    core.info(`No existing preview for slug: ${slug}`)
    config = buildPreviewValues(slug, serviceName, commitSha, catalog, inputs)
  }
  endGroup()

  let yamlContent = dumpYaml(config)

  if (exists && oldContent !== undefined) {
    startGroup(`Diff: ${filePath}`)
    logDiff(oldContent, yamlContent)
    endGroup()
  } else {
    startGroup(`Creating ${filePath}`)
    core.debug(yamlContent)
    endGroup()
  }

  // Push to gitops repo with retry on 409
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    core.info(`Attempt ${attempt} of ${MAX_RETRIES}`)
    try {
      const contentBase64 = Buffer.from(yamlContent).toString('base64')
      const isUpdate = exists && fileSha !== undefined
      const commitMessage = isUpdate
        ? `chore(preview): update ${serviceName} in ${slug}`
        : `chore(preview): create ${slug} preview`

      const { data } = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: commitMessage,
        content: contentBase64,
        ...(isUpdate ? { sha: fileSha } : {}),
      })

      const commitUrl = data.commit.html_url ?? ''
      core.notice(`Successfully pushed values.yaml: ${commitUrl}`)
      core.setOutput('preview-slug', slug)
      core.setOutput('gitops-commit-url', commitUrl)
      const summary = buildSummary(slug, config, commitMessage, commitUrl)
      await writeSummary(summary)
      if (inputs.prNumber && inputs.githubToken) {
        const { owner: srcOwner, repo: srcRepo } = github.context.repo
        const sourceOctokit = github.getOctokit(inputs.githubToken)
        await postOrUpdatePrComment(sourceOctokit, srcOwner, srcRepo, parseInt(inputs.prNumber), summary)
      }
      return
    } catch (e) {
      const status = (e as { status?: number }).status
      if (status === 409) {
        core.warning('Conflict (409) — re-fetching file SHA and retrying...')
        const { data } = await octokit.rest.repos.getContent({ owner, repo, path: filePath })
        if (Array.isArray(data) || data.type !== 'file') throw new Error('Not a file', { cause: e })
        fileSha = data.sha
        exists = true
        const freshConfig = yaml.load(
          Buffer.from(data.content, 'base64').toString('utf-8'),
        ) as PreviewValues
        config = updatePreviewValues(freshConfig, serviceName, commitSha, inputs)
        yamlContent = dumpYaml(config)
        continue
      }
      if (status === 401 || status === 403) {
        throw new Error(`GITOPS_TOKEN lacks write access to ${gitopsRepo} (HTTP ${status})`, {
          cause: e,
        })
      }
      throw e
    }
  }

  throw new Error(`Failed to push after ${MAX_RETRIES} attempts`)
}
