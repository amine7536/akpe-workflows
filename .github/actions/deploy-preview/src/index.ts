import * as core from '@actions/core'
import * as github from '@actions/github'
import { main } from './deploy'
import { postOrUpdatePrComment, writeSummary } from './gha'

async function run(): Promise<void> {
  const inputs = {
    gitopsRepo: core.getInput('gitops-repo', { required: true }),
    gitopsToken: core.getInput('gitops-token', { required: true }),
    serviceName: core.getInput('service-name', { required: true }),
    headRef: core.getInput('head-ref', { required: true }),
    commitSha: core.getInput('commit-sha', { required: true }),
    prAuthor: core.getInput('pr-author'),
    prUrl: core.getInput('pr-url'),
    prNumber: core.getInput('pr-number'),
    timestamp: core.getInput('timestamp'),
    workflowRunUrl: core.getInput('workflow-run-url'),
    githubToken: core.getInput('github-token') || undefined,
  }

  try {
    await main(inputs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.error(message)
    const failureSummary = `> ❌ Deploy failed: ${message}`
    await writeSummary(failureSummary)
    if (inputs.githubToken && inputs.prNumber) {
      const { owner, repo } = github.context.repo
      const octokit = github.getOctokit(inputs.githubToken)
      try {
        await postOrUpdatePrComment(octokit, owner, repo, parseInt(inputs.prNumber), failureSummary)
      } catch (e) {
        core.warning(`Could not post failure comment: ${(e as Error).message}`)
      }
    }
    core.setFailed(message)
  }
}

run()
