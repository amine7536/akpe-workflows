import * as core from '@actions/core'
import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

const PR_COMMENT_MARKER = '<!-- akpe-preview -->'

export function startGroup(title: string): void {
  core.startGroup(title)
}

export function endGroup(): void {
  core.endGroup()
}

export async function writeSummary(markdown: string): Promise<void> {
  await core.summary.addRaw(markdown).write()
}

export async function postOrUpdatePrComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const markedBody = `${PR_COMMENT_MARKER}\n${body}`

  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
  })

  const existing = comments.find((c) => c.body?.includes(PR_COMMENT_MARKER))

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: markedBody,
    })
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: markedBody,
    })
  }
}
