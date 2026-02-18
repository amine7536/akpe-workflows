# akpe-workflows

Reusable GitHub Actions workflows for the AKPE platform.

## Workflows

### Build and Push (`build-and-push.yml`)

Builds a Docker image and pushes it to `ghcr.io`. Supports multi-arch (amd64/arm64). Tags images with the full commit SHA.

**Inputs:**
- `image_name` (required) — Docker image name (e.g. `amine7536/akpe-backend-1`)

**Outputs:**
- `image_tag` — The commit SHA used as image tag

### Deploy Preview (`deploy-preview.yml`)

Creates or updates a preview environment by managing `previews/<slug>/values.yaml` in the [akpe-gitops](https://github.com/amine7536/akpe-gitops) repo. Runs a Python script (`.github/scripts/deploy-preview.py`) that handles GitHub API calls, YAML manipulation, and 409 conflict retries.

**Inputs:**
- `service_name` (required) — Service name (e.g. `backend-1`, `backend-2`, `front`)

**Secrets:**
- `GITOPS_PAT` — GitHub PAT with write access to the gitops repo

Service configuration (names) lives in `.github/scripts/config.py`.

### Deploy Production (`deploy-production.yml`)

Updates the image tag in the gitops repo's `production/<service>.yaml` and pushes. Uses a concurrency group to serialize updates.

**Inputs:**
- `service_name` (required) — Service name (e.g. `backend-1`, `backend-2`, `front`)

**Secrets:**
- `GITOPS_PAT` — GitHub PAT with write access to the gitops repo

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

  deploy-production:
    needs: build
    if: github.ref == 'refs/heads/main'
    uses: amine7536/akpe-workflows/.github/workflows/deploy-production.yml@main
    with:
      service_name: backend-1
    secrets: inherit
```
