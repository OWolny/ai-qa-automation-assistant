# QA Automation

This repository holds independent QA automation projects. Each project targets one system under test and owns its framework, dependencies, configuration, and tests.

## Structure

```text
.
├── README.md
├── .gitignore              # repository-wide ignore rules (secrets, reports, artifacts, local tooling)
└── projects/
    └── web-e2e/            # Playwright + TypeScript end-to-end tests for a web application
```

## How projects are organized

- Every project lives in `projects/<project-name>/` and is self-contained.
- A project owns its framework-specific dependencies (for example its own `package.json` and lockfile). The repository has no shared package manager workspace.
- Tests live in the project's `tests/` directory.
- Generated output (reports, traces, screenshots, videos) is written inside the project directory and is git-ignored.
- Secrets and environment-specific values go in a local `.env`, which is git-ignored. A project documents the variables it needs in `.env.example`.
- Shared infrastructure is added only after the same code is actually needed by more than one project.

## Projects

| Project | Framework | Description |
|---------|-----------|-------------|
| [`web-e2e`](projects/web-e2e/) | Playwright, TypeScript | UI and API tests for [practice.expandtesting.com](https://practice.expandtesting.com/) |

## Getting started with `web-e2e`

Requires Node.js 20 or newer.

```bash
cd projects/web-e2e
npm ci
npm run install:browsers
npm run typecheck
npm run lint
npm test
```

See [`projects/web-e2e/README.md`](projects/web-e2e/README.md) for details.

## Local tooling

Developers may use local tooling that puts extra files in their working copy. The repository's `.gitignore` covers these files, so they are never committed.
