GITOPS_REPO_OWNER = "amine7536"
GITOPS_REPO_NAME = "akpe-gitops"
MAX_RETRIES = 3

SERVICES = [
    {
        "name": "backend-1",
        "helm_params": [
            {"name": "database.name", "value_template": "backend-1-{{slug}}"},
        ],
    },
    {"name": "backend-2"},
    {"name": "front"},
]
