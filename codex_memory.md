# Codex memory for domain-dashboard

## Sites deployment boundary

This project is connected to OpenAI Sites through `.openai/hosting.json`, but Codex must not automatically save or deploy a Sites version after ordinary edits.

Default behavior for future work in this repository:

- Make source, data, or UI changes locally.
- Run local validation such as `npm run build` when appropriate.
- Do not call Sites save/deploy tools automatically.
- Do not push to the Sites source repository automatically.
- Treat production deployment as an explicit separate action.

Only publish to Sites when the user clearly asks with language such as:

- “部署”
- “发布”
- “更新线上”
- “push 到 Sites”
- “deploy this”
- “publish this”

If the user only asks to modify content, data, style, or local behavior, stop after local changes and report that the live Sites deployment was not updated.

## Branch and Sites source relationship

Current branch roles after the July 2026 branch simplification:

- `apple-design-preview` is the main working branch for the Apple-style dashboard UI.
- `origin/apple-design-preview` is the GitHub remote-tracking reference for that working branch.
- `main` / `origin/main` are the original/base branch line and are kept separately from the Apple-style working branch.

The intended branch layout is deliberately small:

- Local branches: `apple-design-preview`, `main`.
- GitHub `origin` branches: `origin/apple-design-preview`, `origin/main`.
- No persistent local `sites` remote.
- No local or remote-tracking `sites/main` branch in this checkout.

The old local `sites` remote and stale `sites/main` remote-tracking reference
were removed so the repository feels like a normal two-branch GitHub project.
OpenAI Sites still has its own internal source repository for deployments, but
that is an implementation detail of the hosting system rather than a branch
that should be edited directly here.

Do not develop directly against a Sites source branch. Develop on
`apple-design-preview`, then explicitly push/save/deploy to Sites only when the
user asks for production publishing.

When publishing is explicitly requested, use the source state from
`apple-design-preview`, run the normal local validation first, and let the
Sites tooling reuse the existing `.openai/hosting.json` project id. Do not
recreate a `sites` remote or add back `sites/main` just to publish.
