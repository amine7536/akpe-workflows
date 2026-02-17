import { Octokit } from "npm:@octokit/rest@^21";
import { stringify, parse } from "npm:yaml@^2";
import { GITOPS_REPO, MAX_RETRIES, SERVICES } from "./config.ts";

interface HelmParam {
  name: string;
  value: string;
}

interface Service {
  name: string;
  image_tag?: string;
  helm_params?: HelmParam[];
}

interface AppsConfig {
  services: Service[];
}

function slugify(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function resolveHelmParams(
  slug: string,
  params?: { name: string; valueTemplate: string }[],
): HelmParam[] | undefined {
  if (!params?.length) return undefined;
  return params.map((p) => ({
    name: p.name,
    value: p.valueTemplate.replace("{{slug}}", slug),
  }));
}

function buildAppsYaml(
  slug: string,
  serviceName: string,
  commitSha: string,
): AppsConfig {
  return {
    services: SERVICES.map((svc) => {
      const entry: Service = { name: svc.name };
      if (svc.name === serviceName) {
        entry.image_tag = commitSha;
      }
      const helmParams = resolveHelmParams(slug, svc.helmParams);
      if (helmParams) {
        entry.helm_params = helmParams;
      }
      return entry;
    }),
  };
}

function updateAppsYaml(
  existing: AppsConfig,
  serviceName: string,
  commitSha: string,
): AppsConfig {
  const found = existing.services.find((s) => s.name === serviceName);
  if (found) {
    found.image_tag = commitSha;
  } else {
    existing.services.push({ name: serviceName, image_tag: commitSha });
  }
  return existing;
}

async function main() {
  const token = Deno.env.get("GITOPS_TOKEN");
  const serviceName = Deno.env.get("SERVICE_NAME");
  const headRef = Deno.env.get("HEAD_REF");
  const commitSha = Deno.env.get("COMMIT_SHA");

  if (!token || !serviceName || !headRef || !commitSha) {
    console.error(
      "Missing required env vars: GITOPS_TOKEN, SERVICE_NAME, HEAD_REF, COMMIT_SHA",
    );
    Deno.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const slug = slugify(headRef);
  console.log(`Branch: ${headRef} -> Slug: ${slug}`);

  const filePath = `previews/${slug}/apps.yaml`;

  // Try to get existing file
  let exists = false;
  let fileSha: string | undefined;
  let config: AppsConfig;

  try {
    const { data } = await octokit.repos.getContent({
      ...GITOPS_REPO,
      path: filePath,
    });

    if ("content" in data && "sha" in data) {
      exists = true;
      fileSha = data.sha;
      const content = atob(data.content.replace(/\n/g, ""));
      const existing = parse(content) as AppsConfig;
      console.log("Current apps.yaml:");
      console.log(content);
      config = updateAppsYaml(existing, serviceName, commitSha);
      console.log("Updated apps.yaml:");
    }
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
      console.log(`No existing preview for slug: ${slug}`);
    } else {
      throw err;
    }
  }

  if (!exists) {
    config = buildAppsYaml(slug, serviceName, commitSha);
    console.log("Generated apps.yaml:");
  }

  let yamlContent = stringify(config!);
  console.log(yamlContent);

  // Push to gitops repo with retry on 409
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`Attempt ${attempt} of ${MAX_RETRIES}`);

    try {
      const message = exists
        ? `chore(preview): update ${serviceName} in ${slug}`
        : `chore(preview): create ${slug} preview`;

      await octokit.repos.createOrUpdateFileContents({
        ...GITOPS_REPO,
        path: filePath,
        message,
        content: btoa(yamlContent),
        ...(exists && fileSha ? { sha: fileSha } : {}),
      });

      console.log("Successfully pushed apps.yaml");
      return;
    } catch (err: unknown) {
      if (err instanceof Error && "status" in err && (err as { status: number }).status === 409) {
        console.log("Conflict (409) — re-fetching file SHA and retrying...");

        const { data } = await octokit.repos.getContent({
          ...GITOPS_REPO,
          path: filePath,
        });

        if ("content" in data && "sha" in data) {
          fileSha = data.sha;
          exists = true;
          const freshContent = atob(data.content.replace(/\n/g, ""));
          const freshConfig = parse(freshContent) as AppsConfig;
          updateAppsYaml(freshConfig, serviceName, commitSha);
          yamlContent = stringify(freshConfig);
        }
        continue;
      }
      throw err;
    }
  }

  console.error(`Failed after ${MAX_RETRIES} attempts`);
  Deno.exit(1);
}

main();
