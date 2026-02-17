export const GITOPS_REPO = { owner: "amine7536", repo: "akpe-gitops" };
export const MAX_RETRIES = 3;

export interface ServiceConfig {
  name: string;
  helmParams?: { name: string; valueTemplate: string }[];
}

// valueTemplate supports {{slug}} placeholder, resolved at runtime
export const SERVICES: ServiceConfig[] = [
  {
    name: "backend-1",
    helmParams: [
      { name: "database.name", valueTemplate: "backend-1-{{slug}}" },
    ],
  },
  { name: "backend-2" },
  { name: "front" },
];
