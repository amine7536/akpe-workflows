import * as core from '@actions/core'
import { main } from './deploy'
import { writeSummary } from './gha'

async function run(): Promise<void> {
  try {
    await main({
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
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    core.error(message)
    await writeSummary(`> ❌ Deploy failed: ${message}`)
    core.setFailed(message)
  }
}

run()
