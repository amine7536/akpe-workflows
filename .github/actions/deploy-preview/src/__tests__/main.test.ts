jest.mock('@actions/core', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
  setOutput: jest.fn(),
}))

jest.mock('@actions/github')

const mockPostOrUpdatePrComment = jest.fn().mockResolvedValue(undefined)
jest.mock('../gha', () => ({
  startGroup: jest.fn(),
  endGroup: jest.fn(),
  writeSummary: jest.fn().mockResolvedValue(undefined),
  postOrUpdatePrComment: mockPostOrUpdatePrComment,
}))

import * as core from '@actions/core'
import * as github from '@actions/github'
import * as yaml from 'js-yaml'
import { main } from '../deploy'
import { ActionInputs } from '../types'

const testInputs: ActionInputs = {
  gitopsRepo: 'owner/gitops',
  gitopsToken: 'token',
  serviceName: 'backend-1',
  headRef: 'feature/my-branch',
  commitSha: 'abc123def456',
  prAuthor: 'dev',
  prUrl: 'https://github.com/owner/akpe-backend-1/pull/1',
  prNumber: '1',
  timestamp: '2026-02-20T10:00:00Z',
  workflowRunUrl: 'https://github.com/owner/akpe-backend-1/actions/runs/123',
}

const SERVICES_YAML = yaml.dump({
  serviceRepos: { 'backend-1': {}, 'backend-2': {}, front: {} },
})

function makeOctokit({ commitUrl = 'https://github.com/owner/gitops/commit/xyz' } = {}) {
  const getContent = jest.fn().mockImplementation(({ path }: { path: string }) => {
    if (path === 'services.yaml') {
      return Promise.resolve({
        data: { type: 'file', content: Buffer.from(SERVICES_YAML).toString('base64'), sha: 'sha-svc' },
      })
    }
    // preview file not found → new preview
    return Promise.reject({ status: 404 })
  })

  const createOrUpdateFileContents = jest.fn().mockResolvedValue({
    data: { commit: { html_url: commitUrl } },
  })

  return { rest: { repos: { getContent, createOrUpdateFileContents } } }
}

describe('main', () => {
  beforeEach(() => jest.clearAllMocks())

  it('emits preview-slug output on success', async () => {
    ;(github.getOctokit as jest.Mock).mockReturnValue(makeOctokit())
    await main(testInputs)
    expect(core.setOutput).toHaveBeenCalledWith('preview-slug', 'feature-my-branch')
  })

  it('emits gitops-commit-url output on success', async () => {
    const commitUrl = 'https://github.com/owner/gitops/commit/abc123'
    ;(github.getOctokit as jest.Mock).mockReturnValue(makeOctokit({ commitUrl }))
    await main(testInputs)
    expect(core.setOutput).toHaveBeenCalledWith('gitops-commit-url', commitUrl)
  })

  it('calls core.notice on success', async () => {
    ;(github.getOctokit as jest.Mock).mockReturnValue(makeOctokit())
    await main(testInputs)
    expect(core.notice).toHaveBeenCalledWith(expect.stringContaining('Successfully pushed'))
  })

  it('fans out PR comment to all services with PR metadata', async () => {
    ;(github.getOctokit as jest.Mock).mockReturnValue(makeOctokit())
    await main(testInputs)
    // Only backend-1 has pr-url/pr-number (the triggering service)
    expect(mockPostOrUpdatePrComment).toHaveBeenCalledTimes(1)
    expect(mockPostOrUpdatePrComment).toHaveBeenCalledWith(
      expect.anything(),
      'owner',
      'akpe-backend-1',
      1,
      expect.stringContaining('feature-my-branch'),
    )
  })

  it('throws when gitops-repo is malformed', async () => {
    await expect(main({ ...testInputs, gitopsRepo: 'invalid' })).rejects.toThrow(
      "GITOPS_REPO must be set in 'owner/repo' format.",
    )
  })

  it('throws when service not in catalog', async () => {
    ;(github.getOctokit as jest.Mock).mockReturnValue(makeOctokit())
    await expect(main({ ...testInputs, serviceName: 'unknown-svc' })).rejects.toThrow(
      "Service 'unknown-svc' not found",
    )
  })
})
