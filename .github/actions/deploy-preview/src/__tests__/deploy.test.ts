import { buildPreviewValues, buildSummary, slugify, updatePreviewValues } from '../deploy'
import { ActionInputs } from '../types'

const testInputs: ActionInputs = {
  gitopsRepo: 'owner/gitops',
  gitopsToken: 'token',
  serviceName: 'backend-1',
  headRef: 'feature/my-branch',
  commitSha: 'abc123def456',
  prAuthor: 'dev',
  prUrl: 'https://github.com/owner/repo/pull/1',
  prNumber: '1',
  timestamp: '2026-02-20T10:00:00Z',
  workflowRunUrl: 'https://github.com/owner/repo/actions/runs/123',
}

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(slugify('feature/my-branch')).toBe('feature-my-branch')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('feat--double')).toBe('feat-double')
  })

  it('strips leading and trailing hyphens', () => {
    expect(slugify('-branch-')).toBe('branch')
  })

  it('handles uppercase', () => {
    expect(slugify('UPPER_CASE')).toBe('upper-case')
  })

  it('handles slashes', () => {
    expect(slugify('feature/some/nested')).toBe('feature-some-nested')
  })

  it('handles already-clean slug', () => {
    expect(slugify('my-branch')).toBe('my-branch')
  })
})

describe('buildPreviewValues', () => {
  it('creates entries for all catalog services', () => {
    const result = buildPreviewValues(
      'feature-my-branch',
      'backend-1',
      'abc123',
      ['backend-1', 'backend-2', 'front'],
      testInputs,
    )
    expect(result.services).toHaveLength(3)
  })

  it('pins commitSha only for the target service', () => {
    const result = buildPreviewValues(
      'slug',
      'backend-1',
      'abc123',
      ['backend-1', 'backend-2'],
      testInputs,
    )
    expect(result.services.find((s) => s.name === 'backend-1')?.commitSha).toBe('abc123')
    expect(result.services.find((s) => s.name === 'backend-2')?.commitSha).toBeUndefined()
  })

  it('sets metadata only for the target service', () => {
    const result = buildPreviewValues(
      'slug',
      'backend-1',
      'sha',
      ['backend-1', 'backend-2'],
      testInputs,
    )
    expect(result.services.find((s) => s.name === 'backend-1')?.metadata).toBeDefined()
    expect(result.services.find((s) => s.name === 'backend-2')?.metadata).toBeUndefined()
  })

  it('preserves catalog order', () => {
    const catalog = ['front', 'backend-1', 'backend-2']
    const result = buildPreviewValues('slug', 'backend-1', 'sha', catalog, testInputs)
    expect(result.services.map((s) => s.name)).toEqual(catalog)
  })
})

describe('updatePreviewValues', () => {
  const baseMetadata = {
    'created-at': '2026-01-01T00:00:00Z',
    'updated-at': '',
    'pr-author': '',
    'pr-url': '',
    'pr-number': '',
    'vcs.ref.name': '',
    'cicd.pipeline.run.url': '',
  }

  it('updates commitSha of existing service', () => {
    const existing = {
      services: [{ name: 'backend-1', commitSha: 'old-sha', metadata: { ...baseMetadata } }],
    }
    const result = updatePreviewValues(existing, 'backend-1', 'new-sha', testInputs)
    expect(result.services[0].commitSha).toBe('new-sha')
  })

  it('preserves created-at from existing metadata', () => {
    const createdAt = '2026-01-01T00:00:00Z'
    const existing = {
      services: [
        {
          name: 'backend-1',
          commitSha: 'old',
          metadata: { ...baseMetadata, 'created-at': createdAt },
        },
      ],
    }
    const result = updatePreviewValues(existing, 'backend-1', 'new', testInputs)
    expect(result.services[0].metadata?.['created-at']).toBe(createdAt)
  })

  it('sets updated-at to new timestamp', () => {
    const existing = {
      services: [{ name: 'backend-1', commitSha: 'old', metadata: { ...baseMetadata } }],
    }
    const result = updatePreviewValues(existing, 'backend-1', 'new', testInputs)
    expect(result.services[0].metadata?.['updated-at']).toBe(testInputs.timestamp)
  })

  it('appends new service if not in existing list', () => {
    const existing = { services: [{ name: 'backend-1', commitSha: 'sha' }] }
    const result = updatePreviewValues(existing, 'backend-2', 'sha2', testInputs)
    expect(result.services).toHaveLength(2)
    expect(result.services[1].name).toBe('backend-2')
    expect(result.services[1].commitSha).toBe('sha2')
  })

  it('does not change other services when updating one', () => {
    const existing = {
      services: [
        { name: 'backend-1', commitSha: 'sha1', metadata: { ...baseMetadata } },
        { name: 'backend-2', commitSha: 'sha2' },
      ],
    }
    const result = updatePreviewValues(existing, 'backend-1', 'new-sha', testInputs)
    expect(result.services[1].commitSha).toBe('sha2')
  })
})

describe('buildSummary', () => {
  it('renders header with slug', () => {
    const config = { services: [] }
    const summary = buildSummary('my-slug', config, 'chore: update', 'https://commit.url')
    expect(summary).toContain('## 🚀 Preview: `my-slug`')
  })

  it('renders service as list item', () => {
    const config = { services: [{ name: 'backend-1', commitSha: 'abc123def456' }] }
    const summary = buildSummary('slug', config, 'msg', 'url')
    expect(summary).toContain('- **backend-1**')
  })

  it('shows pinned sha as linked code when pr-url present', () => {
    const config = {
      services: [
        {
          name: 'backend-1',
          commitSha: 'abc123def456',
          metadata: {
            'pr-url': 'https://github.com/owner/repo/pull/1',
            'pr-number': '1',
            'created-at': '',
            'updated-at': '',
            'pr-author': '',
            'vcs.ref.name': '',
            'cicd.pipeline.run.url': '',
          },
        },
      ],
    }
    const summary = buildSummary('slug', config, 'msg', 'url')
    expect(summary).toContain('📌 [`abc123de`](https://github.com/owner/repo/commit/abc123def456)')
  })

  it('shows pinned sha without link when no pr-url', () => {
    const config = { services: [{ name: 'backend-1', commitSha: 'abc123def456' }] }
    const summary = buildSummary('slug', config, 'msg', 'url')
    expect(summary).toContain('📌 `abc123de`')
    expect(summary).not.toContain('`abc123de`](')
  })

  it('shows tracking main for service without commitSha', () => {
    const config = { services: [{ name: 'front' }] }
    const summary = buildSummary('slug', config, 'msg', 'url')
    expect(summary).toContain('🔄 `main`')
  })

  it('includes PR link when metadata present', () => {
    const config = {
      services: [
        {
          name: 'backend-1',
          commitSha: 'abc123def456',
          metadata: {
            'pr-url': 'https://github.com/owner/repo/pull/42',
            'pr-number': '42',
            'created-at': '',
            'updated-at': '',
            'pr-author': '',
            'vcs.ref.name': '',
            'cicd.pipeline.run.url': '',
          },
        },
      ],
    }
    const summary = buildSummary('slug', config, 'msg', 'url')
    expect(summary).toContain('[PR #42](https://github.com/owner/repo/pull/42)')
  })

  it('includes gitops commit link', () => {
    const config = { services: [] }
    const summary = buildSummary('slug', config, 'chore: create preview', 'https://commit.url')
    expect(summary).toContain('[chore: create preview](https://commit.url)')
  })
})
