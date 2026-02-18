"""Deploy preview environment by managing values.yaml in the gitops repo."""

import base64
import difflib
import os
import re
import sys

import yaml
from github import Github, GithubException

import gha
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


def build_summary(slug: str, config: dict, commit_message: str, commit_url: str) -> str:
    lines = [f"## Preview: `{slug}`", ""]
    lines.append("| Service | Status | Ref |")
    lines.append("|---------|--------|-----|")
    for svc in config.get("services", []):
        name = svc.get("name", "")
        sha = svc.get("commitSha")
        metadata = svc.get("metadata") or {}
        pr_url = metadata.get("pr-url", "")
        pr_number = metadata.get("pr-number", "")
        if sha:
            sha_short = sha[:8] if len(sha) >= 8 else sha
            ref = f"[PR #{pr_number}]({pr_url})" if pr_url else "—"
            status = f"📌 {sha_short}"
        else:
            status = "🔄 tracking main"
            ref = "—"
        lines.append(f"| {name} | {status} | {ref} |")
    lines.append("")
    lines.append(f"**Gitops commit:** [{commit_message}]({commit_url})")
    return "\n".join(lines)


def fail(message: str) -> None:
    gha.error(message)
    gha.write_summary(f"> ❌ Deploy failed: {message}")
    sys.exit(1)


def main() -> None:
    gitops_repo = os.environ.get("GITOPS_REPO", "")
    token = os.environ.get("GITOPS_TOKEN")
    service_name = os.environ.get("SERVICE_NAME")
    head_ref = os.environ.get("HEAD_REF")
    commit_sha = os.environ.get("COMMIT_SHA")

    # Validate GITOPS_REPO format
    if not gitops_repo or "/" not in gitops_repo:
        fail(
            "GITOPS_REPO must be set in 'owner/repo' format. "
            "Set the vars.GITOPS_REPO org/repo variable or pass the gitops_repo workflow input."
        )

    # Validate all required env vars are present
    missing = [
        name
        for name, val in [
            ("GITOPS_TOKEN", token),
            ("SERVICE_NAME", service_name),
            ("HEAD_REF", head_ref),
            ("COMMIT_SHA", commit_sha),
        ]
        if not val
    ]
    if missing:
        fail(f"Missing required env vars: {', '.join(missing)}")

    gh = Github(token)
    repo = gh.get_repo(gitops_repo)

    # Fetch service catalog from services.yaml
    gha.group("Fetching services.yaml")
    try:
        svc_file = repo.get_contents("services.yaml")
        raw = base64.b64decode(svc_file.content).decode()
        print(raw)
        services_data = yaml.safe_load(raw)
        if not isinstance(services_data, dict) or "serviceRepos" not in services_data:
            raise KeyError("serviceRepos")
        catalog = list(services_data["serviceRepos"].keys())
        print(f"Catalog: {', '.join(catalog)}")
    except GithubException as e:
        gha.endgroup()
        if e.status == 404:
            fail(f"services.yaml not found in {gitops_repo}. Ensure the file exists at the repo root.")
        else:
            fail(f"Failed to fetch services.yaml from {gitops_repo}: {e}")
    except (KeyError, TypeError):
        gha.endgroup()
        fail("services.yaml is malformed or missing 'serviceRepos' key")
    gha.endgroup()

    # Validate service_name is in catalog
    if service_name not in catalog:
        available = ", ".join(catalog)
        fail(f"Service '{service_name}' not found in services.yaml. Available: {available}")

    slug = slugify(head_ref)
    print(f"Branch: {head_ref} -> Slug: {slug}")

    file_path = f"previews/{slug}/values.yaml"

    # Try to get existing file
    exists = False
    file_sha = None
    config = None
    old_content = None

    gha.group(f"Current state: {file_path}")
    try:
        contents = repo.get_contents(file_path)
        exists = True
        file_sha = contents.sha
        old_content = base64.b64decode(contents.content).decode()
        print(old_content)
        existing = yaml.safe_load(old_content)
        config = update_preview_values(existing, service_name, commit_sha)
    except GithubException as e:
        if e.status == 404:
            print(f"No existing preview for slug: {slug}")
        else:
            gha.endgroup()
            raise
    gha.endgroup()

    if not exists:
        config = build_preview_values(slug, service_name, commit_sha, catalog)

    yaml_content = yaml.dump(config, default_flow_style=False, sort_keys=False)

    if exists and old_content is not None:
        gha.group(f"Diff: {file_path}")
        diff = list(
            difflib.unified_diff(
                old_content.splitlines(keepends=True),
                yaml_content.splitlines(keepends=True),
                fromfile=f"a/{file_path}",
                tofile=f"b/{file_path}",
            )
        )
        print("".join(diff) if diff else "(no changes)")
        gha.endgroup()
    else:
        gha.group(f"Creating {file_path}")
        print(yaml_content)
        gha.endgroup()

    # Push to gitops repo with retry on 409
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"Attempt {attempt} of {MAX_RETRIES}")

        try:
            if exists and file_sha:
                commit_message = f"chore(preview): update {service_name} in {slug}"
                result = repo.update_file(file_path, commit_message, yaml_content, file_sha)
            else:
                commit_message = f"chore(preview): create {slug} preview"
                result = repo.create_file(file_path, commit_message, yaml_content)

            commit_url = result["commit"].html_url
            print(f"Successfully pushed values.yaml: {commit_url}")
            gha.write_summary(build_summary(slug, config, commit_message, commit_url))
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
            elif e.status in (401, 403):
                fail(
                    f"GITOPS_TOKEN lacks write access to {gitops_repo} (HTTP {e.status}). "
                    "Ensure the token has 'Contents: write' permission."
                )
            raise

    fail(f"Failed to push after {MAX_RETRIES} attempts")


if __name__ == "__main__":
    main()
