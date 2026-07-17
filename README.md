# Domain Dashboard

A local-first dashboard for keeping scattered domain names visible in one place.

## Branch Policy

This repository intentionally keeps a small branch model:

- `apple-design-preview` is the primary working version of the site. It contains
  the Apple-inspired interface and should be used for local preview, future
  design work, and any explicitly requested Sites deployment.
- `main` is kept as the original/base branch line with the same sanitized data
  shape for compatibility and fallback.
- GitHub `origin` should mirror only those two branches:
  `origin/apple-design-preview` and `origin/main`.
- The repo does not keep a persistent local `sites` remote or a `sites/main`
  branch. OpenAI Sites has its own internal deployment source, but local work
  should stay on the two GitHub branches above.

If you are unsure which branch to use for UI work, use `apple-design-preview`.

## Sites Publishing

OpenAI Sites configuration lives in `.openai/hosting.json`. Treat production
publishing as an explicit step, separate from ordinary local edits.

For normal local work:

- Edit on `apple-design-preview`.
- Run `npm run build` when validation is needed.
- Do not save/deploy to Sites unless specifically asked.

When publishing is requested, build from the current `apple-design-preview`
source state and let the Sites tooling reuse the existing project id. There is
no need to recreate a local `sites` remote or revive a `sites/main` branch.

The dashboard reads generated `public/domains.json` in the browser. `scripts/sync-domains.mjs` can pull from provider APIs and write the same normalized JSON shape without exposing cloud credentials to the frontend. A safe sample lives at `public/domains.sample.json`.

## Run

```bash
npm install
npm run sync
npm run dev
```

Open the local URL printed by Vite.

## Sync Providers

Create `.env` from `.env.example`, fill one or more provider access keys, then run:

```bash
npm run sync
```

The sync currently reads:

- Aliyun Domain `QueryDomainList` for registered domains and expiration dates.
- Aliyun DNS `DescribeDomains` for DNS-hosted zones and record counts.
- Huawei Cloud Domains `GET /v2/domains` for registered domains and expiration dates.
- Huawei Cloud DNS `GET /v2/zones` for public DNS zones and record counts.

Use read-only IAM/RAM users. Do not put access keys in frontend files.

`public/domains.json` is generated data. Keep only a sanitized dashboard snapshot in Git; avoid committing access keys, private registrar credentials, or raw provider responses.

## Data Shape

```json
{
  "name": "example.com",
  "registrar": "Aliyun",
  "dnsProvider": "Cloudflare",
  "expiresAt": "2026-08-12",
  "autoRenew": true,
  "purpose": "Personal site",
  "owner": "Me",
  "tags": ["production"],
  "notes": "Optional notes",
  "source": ["aliyun-domain"]
}
```

Do not put cloud access keys in frontend files. Keep them in `.env` or a secret manager and let backend/sync scripts produce sanitized JSON.
