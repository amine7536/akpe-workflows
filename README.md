# akpe-workflows

Reusable GitHub Actions workflows for the AKPE platform.

## Workflows

### Build and Push (`build-and-push.yml`)

Builds a Docker image and pushes it to `ghcr.io`. Supports multi-arch (amd64/arm64). Tags images with the full commit SHA.

**Inputs:**
- `image_name` (required) — Docker image name (e.g. `amine7536/akpe-backend-1`)

**Outputs:**
- `commitSha` — The commit SHA used as image tag

### Deploy Preview (`deploy-preview.yml`)

Creates or updates a preview environment by managing `previews/<slug>/values.yaml` in the gitops repo. Runs a Python script (`.github/scripts/deploy-preview.py`) that handles GitHub API calls, YAML manipulation, and 409 conflict retries. The service catalog is read at runtime from `services.yaml` in the gitops repo.

**Inputs:**
- `service_name` (required) — Service name (e.g. `backend-1`, `backend-2`, `front`)
- `gitops_repo` (optional) — Gitops repo in `owner/repo` format; defaults to `vars.GITOPS_REPO`

**Secrets:**
- `GITOPS_PAT` — GitHub PAT with write access to the gitops repo

**Variables:**
- `GITOPS_REPO` (required, org- or repo-level) — Gitops repo in `owner/repo` format (e.g. `myorg/my-gitops`)

## Usage

Call these workflows from service repos:

```yaml
jobs:
  build:
    uses: amine7536/akpe-workflows/.github/workflows/build-and-push.yml@main
    with:
      image_name: amine7536/akpe-backend-1

  deploy-preview:
    needs: build
    uses: amine7536/akpe-workflows/.github/workflows/deploy-preview.yml@main
    with:
      service_name: backend-1
    secrets: inherit

```
