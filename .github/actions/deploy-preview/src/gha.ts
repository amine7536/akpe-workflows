import * as core from '@actions/core'

export function startGroup(title: string): void {
  core.startGroup(title)
}

export function endGroup(): void {
  core.endGroup()
}

export async function writeSummary(markdown: string): Promise<void> {
  await core.summary.addRaw(markdown).write()
}
