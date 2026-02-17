"""Deploy preview environment by managing apps.yaml in the gitops repo."""

import base64
import os
import re
import sys

import yaml
from github import Github, GithubException

from config import GITOPS_REPO_OWNER, GITOPS_REPO_NAME, MAX_RETRIES, SERVICES


def slugify(branch: str) -> str:
    slug = branch.lower()
    slug = re.sub(r"[^a-z0-9]", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def build_apps_yaml(slug: str, service_name: str, commit_sha: str) -> dict:
    services = []
    for svc in SERVICES:
        entry: dict = {"name": svc["name"]}
        if svc["name"] == service_name:
            entry["image_tag"] = commit_sha
        services.append(entry)
    return {"services": services}


def update_apps_yaml(existing: dict, service_name: str, commit_sha: str) -> dict:
    for svc in existing["services"]:
        if svc["name"] == service_name:
            svc["image_tag"] = commit_sha
            return existing
    existing["services"].append({"name": service_name, "image_tag": commit_sha})
    return existing


def main() -> None:
    token = os.environ.get("GITOPS_TOKEN")
    service_name = os.environ.get("SERVICE_NAME")
    head_ref = os.environ.get("HEAD_REF")
    commit_sha = os.environ.get("COMMIT_SHA")

    if not all([token, service_name, head_ref, commit_sha]):
        print(
            "Missing required env vars: GITOPS_TOKEN, SERVICE_NAME, HEAD_REF, COMMIT_SHA",
            file=sys.stderr,
        )
        sys.exit(1)

    gh = Github(token)
    repo = gh.get_repo(f"{GITOPS_REPO_OWNER}/{GITOPS_REPO_NAME}")
    slug = slugify(head_ref)
    print(f"Branch: {head_ref} -> Slug: {slug}")

    file_path = f"previews/{slug}/apps.yaml"

    # Try to get existing file
    exists = False
    file_sha = None
    config = None

    try:
        contents = repo.get_contents(file_path)
        exists = True
        file_sha = contents.sha
        decoded = base64.b64decode(contents.content).decode()
        print("Current apps.yaml:")
        print(decoded)
        existing = yaml.safe_load(decoded)
        config = update_apps_yaml(existing, service_name, commit_sha)
        print("Updated apps.yaml:")
    except GithubException as e:
        if e.status == 404:
            print(f"No existing preview for slug: {slug}")
        else:
            raise

    if not exists:
        config = build_apps_yaml(slug, service_name, commit_sha)
        print("Generated apps.yaml:")

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

            print("Successfully pushed apps.yaml")
            return
        except GithubException as e:
            if e.status == 409:
                print("Conflict (409) — re-fetching file SHA and retrying...")
                contents = repo.get_contents(file_path)
                file_sha = contents.sha
                exists = True
                decoded = base64.b64decode(contents.content).decode()
                fresh_config = yaml.safe_load(decoded)
                update_apps_yaml(fresh_config, service_name, commit_sha)
                yaml_content = yaml.dump(
                    fresh_config, default_flow_style=False, sort_keys=False
                )
                continue
            raise

    print(f"Failed after {MAX_RETRIES} attempts", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
