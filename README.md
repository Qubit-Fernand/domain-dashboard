# Domain Dashboard

A local-first dashboard for keeping scattered domain names visible in one place.

The first version reads `public/domains.json` in the browser. Later, `scripts/sync-domains.mjs` can be replaced with API collectors for Aliyun, Huawei Cloud, Cloudflare, and other providers, writing the same normalized JSON shape.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

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
  "notes": "Optional notes"
}
```

Do not put cloud access keys in frontend files. Keep them in `.env` or a secret manager and let backend/sync scripts produce sanitized JSON.
