import { postOrUpdatePrComment } from '../gha'

const MARKER = '<!-- akpe-preview -->'

function makeOctokit({
  existingComments = [] as Array<{ id: number; body: string }>,
} = {}) {
  const listComments = jest.fn().mockResolvedValue(existingComments)
  const createComment = jest.fn().mockResolvedValue({})
  const updateComment = jest.fn().mockResolvedValue({})

  return {
    paginate: jest.fn().mockImplementation((_fn: unknown, _params: unknown) =>
      Promise.resolve(existingComments),
    ),
    rest: {
      issues: { listComments, createComment, updateComment },
    },
  }
}

describe('postOrUpdatePrComment', () => {
  it('creates a new comment when none exists', async () => {
    const octokit = makeOctokit()
    await postOrUpdatePrComment(octokit as never, 'owner', 'repo', 42, 'body text')
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      body: `${MARKER}\nbody text`,
    })
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('updates existing comment when marker is found', async () => {
    const octokit = makeOctokit({
      existingComments: [{ id: 99, body: `${MARKER}\nold content` }],
    })
    await postOrUpdatePrComment(octokit as never, 'owner', 'repo', 42, 'new content')
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      comment_id: 99,
      body: `${MARKER}\nnew content`,
    })
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
  })

  it('ignores comments without the marker', async () => {
    const octokit = makeOctokit({
      existingComments: [{ id: 1, body: 'some unrelated comment' }],
    })
    await postOrUpdatePrComment(octokit as never, 'owner', 'repo', 7, 'body')
    expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled()
  })

  it('prepends marker to body in both create and update', async () => {
    const octokit = makeOctokit()
    await postOrUpdatePrComment(octokit as never, 'o', 'r', 1, 'my body')
    const call = (octokit.rest.issues.createComment as jest.Mock).mock.calls[0][0]
    expect(call.body).toMatch(new RegExp(`^${MARKER.replace(/[<>!-]/g, '\\$&')}`))
  })
})
