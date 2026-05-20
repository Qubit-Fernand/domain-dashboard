# Domain Dashboard

A local-first dashboard for keeping scattered domain names visible in one place.

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

`public/domains.json` is generated and ignored by Git so real domain inventory does not get committed by accident.

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
