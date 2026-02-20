export interface ServiceMetadata {
  'pr-author': string
  'pr-url': string
  'pr-number': string
  'created-at': string
  'updated-at': string
  'vcs.ref.name': string
  'cicd.pipeline.run.url': string
}

export interface ServiceEntry {
  name: string
  commitSha?: string
  metadata?: ServiceMetadata
}

export interface PreviewValues {
  services: ServiceEntry[]
}

export interface ActionInputs {
  gitopsRepo: string
  gitopsToken: string
  serviceName: string
  headRef: string
  commitSha: string
  prAuthor: string
  prUrl: string
  prNumber: string
  timestamp: string
  workflowRunUrl: string
}
