"""Deploy preview environment by managing values.yaml in the gitops repo."""

import base64
import os
import re
import sys

import yaml
from github import Github, GithubException

from config import MAX_RETRIES


def slugify(branch: str) -> str:
    slug = branch.lower()
    slug = re.sub(r"[^a-z0-9]", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def build_service_metadata() -> dict:
    return {
        "pr-author": os.environ.get("PR_AUTHOR", ""),
        "pr-url": os.environ.get("PR_URL", ""),
        "pr-number": os.environ.get("PR_NUMBER", ""),
        "created-at": os.environ.get("TIMESTAMP", ""),
        "updated-at": os.environ.get("TIMESTAMP", ""),
        "branch": os.environ.get("HEAD_REF", ""),
        "workflow-run-url": os.environ.get("WORKFLOW_RUN_URL", ""),
    }


def build_preview_values(slug: str, service_name: str, commit_sha: str, catalog: list[str]) -> dict:
    services = []
    for name in catalog:
        entry: dict = {"name": name}
        if name == service_name:
            entry["commitSha"] = commit_sha
            entry["metadata"] = build_service_metadata()
        services.append(entry)
    return {"services": services}


def update_preview_values(existing: dict, service_name: str, commit_sha: str) -> dict:
    for svc in existing["services"]:
        if svc["name"] == service_name:
            svc["commitSha"] = commit_sha
            existing_created_at = (svc.get("metadata") or {}).get("created-at", "")
            metadata = build_service_metadata()
            if existing_created_at:
                metadata["created-at"] = existing_created_at
            svc["metadata"] = metadata
            return existing
    existing["services"].append({"name": service_name, "commitSha": commit_sha, "metadata": build_service_metadata()})
    return existing


def main() -> None:
    gitops_repo = os.environ.get("GITOPS_REPO", "")
    token = os.environ.get("GITOPS_TOKEN")
    service_name = os.environ.get("SERVICE_NAME")
    head_ref = os.environ.get("HEAD_REF")
    commit_sha = os.environ.get("COMMIT_SHA")

    if not gitops_repo or "/" not in gitops_repo:
        print("GITOPS_REPO must be set in 'owner/repo' format", file=sys.stderr)
        sys.exit(1)

    if not all([token, service_name, head_ref, commit_sha]):
        print(
            "Missing required env vars: GITOPS_TOKEN, SERVICE_NAME, HEAD_REF, COMMIT_SHA",
            file=sys.stderr,
        )
        sys.exit(1)

    gh = Github(token)
    repo = gh.get_repo(gitops_repo)

    # Fetch service catalog from services.yaml
    try:
        svc_file = repo.get_contents("services.yaml")
        services_data = yaml.safe_load(base64.b64decode(svc_file.content).decode())
        catalog = list(services_data["serviceRepos"].keys())
    except GithubException as e:
        print(f"Failed to fetch services.yaml from {gitops_repo}: {e}", file=sys.stderr)
        sys.exit(1)
    except (KeyError, TypeError):
        print("services.yaml is malformed or missing 'serviceRepos' key", file=sys.stderr)
        sys.exit(1)

    slug = slugify(head_ref)
    print(f"Branch: {head_ref} -> Slug: {slug}")

    file_path = f"previews/{slug}/values.yaml"

    # Try to get existing file
    exists = False
    file_sha = None
    config = None

    try:
        contents = repo.get_contents(file_path)
        exists = True
        file_sha = contents.sha
        decoded = base64.b64decode(contents.content).decode()
        print("Current values.yaml:")
        print(decoded)
        existing = yaml.safe_load(decoded)
        config = update_preview_values(existing, service_name, commit_sha)
        print("Updated values.yaml:")
    except GithubException as e:
        if e.status == 404:
            print(f"No existing preview for slug: {slug}")
        else:
            raise

    if not exists:
        config = build_preview_values(slug, service_name, commit_sha, catalog)
        print("Generated values.yaml:")

    yaml_content = yaml.dump(config, default_flow_style=False, sort_keys=False)
    print(yaml_content)

    # Push to gitops repo with retry on 409
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"Attempt {attempt} of {MAX_RETRIES}")

        try:
            if exists and file_sha:
                message = f"chore(preview): update {service_name} in {slug}"
                repo.update_file(file_path, message, yaml_content, file_sha)
            else:
                message = f"chore(preview): create {slug} preview"
                repo.create_file(file_path, message, yaml_content)

            print("Successfully pushed values.yaml")
            return
        except GithubException as e:
            if e.status == 409:
                print("Conflict (409) — re-fetching file SHA and retrying...")
                contents = repo.get_contents(file_path)
                file_sha = contents.sha
                exists = True
                decoded = base64.b64decode(contents.content).decode()
                fresh_config = yaml.safe_load(decoded)
                update_preview_values(fresh_config, service_name, commit_sha)
                yaml_content = yaml.dump(
                    fresh_config, default_flow_style=False, sort_keys=False
                )
                continue
            raise

    print(f"Failed after {MAX_RETRIES} attempts", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
