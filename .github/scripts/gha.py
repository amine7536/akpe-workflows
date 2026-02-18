"""GitHub Actions workflow commands and step summary helpers."""

import os


def error(message: str, **kwargs) -> None:
    parts = ",".join(f"{k}={v}" for k, v in kwargs.items())
    prefix = f"::error {parts}" if parts else "::error"
    print(f"{prefix}::{message}", flush=True)


def warning(message: str) -> None:
    print(f"::warning::{message}", flush=True)


def notice(message: str) -> None:
    print(f"::notice::{message}", flush=True)


def group(title: str) -> None:
    print(f"::group::{title}", flush=True)


def endgroup() -> None:
    print("::endgroup::", flush=True)


def write_summary(markdown: str) -> None:
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a", encoding="utf-8") as f:
            f.write(markdown + "\n")
    else:
        print("--- SUMMARY ---")
        print(markdown)
        print("--- END SUMMARY ---")
