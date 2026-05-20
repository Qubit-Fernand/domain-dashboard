import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveNs } from "node:dns/promises";
import "dotenv/config";
import * as Alidns from "@alicloud/alidns20150109";
import * as Domain from "@alicloud/domain20180129";
import OpenApi from "@alicloud/openapi-client";
import Util from "@alicloud/tea-util";
import { BasicCredentials } from "@huaweicloud/huaweicloud-sdk-core";
import { AKSKSigner } from "@huaweicloud/huaweicloud-sdk-core/auth/AKSKSigner.js";

const outputPath = resolve("public/domains.json");
const snapshotPath = resolve("data/domains-snapshot.json");
const pageSize = 100;

const aliyunAccessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
const aliyunAccessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
const huaweiAccessKeyId = process.env.HUAWEICLOUD_ACCESS_KEY_ID;
const huaweiSecretAccessKey = process.env.HUAWEICLOUD_SECRET_ACCESS_KEY;

const aliyunConfigured = Boolean(aliyunAccessKeyId && aliyunAccessKeySecret);
const huaweiConfigured = Boolean(huaweiAccessKeyId && huaweiSecretAccessKey);

if (!aliyunConfigured && !huaweiConfigured) {
  console.error("Missing provider credentials in .env. Configure Aliyun and/or Huawei Cloud.");
  process.exit(1);
}

const aliyun = aliyunConfigured ? createAliyunClients() : null;
const huaweiCredential = huaweiConfigured
  ? new BasicCredentials().withAk(huaweiAccessKeyId).withSk(huaweiSecretAccessKey)
  : null;

const [aliyunRegisteredDomains, aliyunDnsDomains, huaweiRegisteredDomains, huaweiDnsDomains] = await Promise.all([
  aliyun ? safeFetch("Aliyun registered domains", () => fetchAliyunRegisteredDomains(aliyun.domainClient, aliyun.runtime)) : [],
  aliyun ? safeFetch("Aliyun DNS domains", () => fetchAliyunDnsDomains(aliyun.dnsClient, aliyun.runtime)) : [],
  huaweiCredential ? safeFetch("Huawei Cloud registered domains", () => fetchHuaweiRegisteredDomains(huaweiCredential)) : [],
  huaweiCredential ? safeFetch("Huawei Cloud DNS zones", () => fetchHuaweiDnsDomains(huaweiCredential)) : [],
]);

const merged = await annotatePublicDnsProviders(
  mergeDomains({
    aliyunRegisteredDomains,
    aliyunDnsDomains,
    huaweiRegisteredDomains,
    huaweiDnsDomains,
  }),
);

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(snapshotPath), { recursive: true });

const payload = `${JSON.stringify(merged, null, 2)}\n`;
await writeFile(outputPath, payload);
await writeFile(snapshotPath, payload);

console.log(`Fetched ${aliyunRegisteredDomains.length} Aliyun registered domains.`);
console.log(`Fetched ${aliyunDnsDomains.length} Aliyun DNS domains.`);
console.log(`Fetched ${huaweiRegisteredDomains.length} Huawei Cloud registered domains.`);
console.log(`Fetched ${huaweiDnsDomains.length} Huawei Cloud DNS zones.`);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${snapshotPath}`);

function createAliyunClients() {
  const config = new OpenApi.Config({
    accessKeyId: aliyunAccessKeyId,
    accessKeySecret: aliyunAccessKeySecret,
    regionId: process.env.ALIYUN_REGION_ID || "cn-hangzhou",
  });
  const DomainClient = Domain.default.default;
  const DnsClient = Alidns.default.default;
  return {
    domainClient: new DomainClient(config),
    dnsClient: new DnsClient(config),
    runtime: new Util.RuntimeOptions({
      connectTimeout: 10000,
      readTimeout: 20000,
      autoretry: true,
      maxAttempts: 2,
    }),
  };
}

async function safeFetch(label, fetcher) {
  try {
    return await fetcher();
  } catch (error) {
    console.warn(`Warning: failed to fetch ${label}: ${formatError(error)}`);
    return [];
  }
}

async function fetchAliyunRegisteredDomains(domainClient, runtime) {
  const domains = [];
  let pageNum = 1;

  while (true) {
    const response = await domainClient.queryDomainListWithOptions(
      new Domain.QueryDomainListRequest({
        lang: "en",
        pageNum,
        pageSize,
        orderKeyType: "ExpirationDate",
        orderByType: "ASC",
        userClientIp: "127.0.0.1",
      }),
      runtime,
    );
    const body = response.body || {};
    const page = body.data?.domain || [];
    domains.push(...page);

    if (!body.nextPage && pageNum >= (body.totalPageNum || pageNum)) break;
    pageNum += 1;
  }

  return domains;
}

async function fetchAliyunDnsDomains(dnsClient, runtime) {
  const domains = [];
  let pageNumber = 1;

  while (true) {
    const response = await dnsClient.describeDomainsWithOptions(
      new Alidns.DescribeDomainsRequest({
        lang: "en",
        pageNumber,
        pageSize,
        searchMode: "LIKE",
        starmark: true,
      }),
      runtime,
    );
    const body = response.body || {};
    const page = body.domains?.domain || [];
    domains.push(...page);

    const total = body.totalCount || domains.length;
    if (domains.length >= total || page.length === 0) break;
    pageNumber += 1;
  }

  return domains;
}

async function fetchHuaweiRegisteredDomains(credential) {
  const domains = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const body = await huaweiGetJson({
      credential,
      endpoint: process.env.HUAWEICLOUD_DOMAIN_ENDPOINT || "https://domain.myhuaweicloud.com",
      path: "/v2/domains",
      queryParams: { limit, offset },
    });
    const page = body.domains || [];
    domains.push(...page);

    const total = body.total || domains.length;
    if (domains.length >= total || page.length === 0) break;
    offset += limit;
  }

  return domains;
}

async function fetchHuaweiDnsDomains(credential) {
  const zones = [];
  const endpoint = `https://dns.${process.env.HUAWEICLOUD_DNS_REGION || "ap-southeast-3"}.myhuaweicloud.com`;
  let marker = undefined;

  while (true) {
    const queryParams = marker ? { limit: pageSize, marker } : { limit: pageSize };
    const body = await huaweiGetJson({ credential, endpoint, path: "/v2/zones", queryParams });
    const page = body.zones || [];
    zones.push(...page);

    const total = body.metadata?.total_count || zones.length;
    marker = readNextMarker(body.links?.next);
    if (zones.length >= total || page.length === 0 || !marker) break;
  }

  return zones;
}

async function huaweiGetJson({ credential, endpoint, path, queryParams }) {
  const query = new URLSearchParams(queryParams).toString();
  const fullUrl = `${endpoint}${path}${query ? `?${query}` : ""}`;
  const request = {
    endpoint: `${endpoint}${path}`,
    url: path,
    method: "GET",
    queryParams,
    headers: { "content-type": "application/json" },
  };
  const headers = AKSKSigner.sign(request, credential);
  let response;
  let text = "";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(fullUrl, {
        headers,
        signal: AbortSignal.timeout(45000),
      });
      text = await response.text();
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(750 * attempt);
    }
  }

  if (!response?.ok) {
    throw new Error(`Huawei Cloud API ${response.status}: ${text.slice(0, 500)}`);
  }

  return text ? JSON.parse(text) : {};
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeDomains({ aliyunRegisteredDomains, aliyunDnsDomains, huaweiRegisteredDomains, huaweiDnsDomains }) {
  const byName = new Map();

  for (const domain of aliyunRegisteredDomains) {
    const name = normalizeDomainName(domain.domainName);
    if (!name) continue;

    byName.set(name, {
      name,
      registrar: domain.registrar || "Aliyun",
      dnsProvider: formatDnsProvider(domain.dnsList?.dnsList),
      expiresAt: normalizeDate(domain.expirationDate, domain.expirationDateLong),
      autoRenew: Boolean(domain.autoRenewEnabled),
      purpose: domain.remark || domain.domainGroupName || "Registered domain",
      owner: domain.ccompany || "Me",
      tags: compactTags([
        "aliyun",
        "registered",
        domain.domainStatus,
        domain.expirationDateStatus,
        domain.domainGroupName,
        ...readTags(domain.tag?.tag),
      ]),
      notes: compactText([
        domain.remark,
        domain.instanceId ? `Instance: ${domain.instanceId}` : "",
        domain.domainAuditStatus ? `Audit: ${domain.domainAuditStatus}` : "",
      ]),
      source: ["aliyun-domain"],
    });
  }

  for (const domain of aliyunDnsDomains) {
    const name = normalizeDomainName(domain.domainName);
    if (!name) continue;

    const existing = byName.get(name);
    const dnsServers = domain.dnsServers?.dnsServer || [];
    const dnsTags = compactTags([
      "dns",
      domain.groupName,
      domain.versionName,
      domain.domainLoggingSwitchStatus === "OPEN" ? "logging" : "",
      ...readTags(domain.tags?.tag),
    ]);

    if (existing) {
      existing.dnsProvider = dnsServers.length > 0 ? `Aliyun DNS (${dnsServers.join(", ")})` : "Aliyun DNS";
      existing.tags = compactTags([...existing.tags, ...dnsTags]);
      existing.notes = compactText([
        existing.notes,
        domain.recordCount != null ? `DNS records: ${domain.recordCount}` : "",
        domain.remark,
      ]);
      existing.source = compactTags([...existing.source, "aliyun-dns"]);
      continue;
    }

    byName.set(name, {
      name,
      registrar: domain.aliDomain ? "Aliyun" : "Unknown",
      dnsProvider: dnsServers.length > 0 ? `Aliyun DNS (${dnsServers.join(", ")})` : "Aliyun DNS",
      expiresAt: null,
      autoRenew: false,
      purpose: domain.remark || domain.groupName || "DNS zone",
      owner: "Me",
      tags: compactTags(["aliyun", ...dnsTags]),
      notes: compactText([
        domain.recordCount != null ? `DNS records: ${domain.recordCount}` : "",
        domain.instanceEndTime ? `DNS product expires: ${normalizeDate(domain.instanceEndTime)}` : "",
      ]),
      source: ["aliyun-dns"],
    });
  }

  for (const domain of huaweiRegisteredDomains) {
    const name = normalizeDomainName(domain.domain_name);
    if (!name) continue;

    const existing = byName.get(name);
    const domainPayload = {
      name,
      registrar: "华为云",
      dnsProvider: existing?.dnsProvider || "Unknown",
      expiresAt: normalizeDate(domain.expire_date),
      autoRenew: domain.auto_renew === "1" || domain.auto_renew_inner === "1",
      purpose: "Registered domain",
      owner: "Me",
      tags: compactTags(["huawei-cloud", "registered", domain.status, domain.audit_status, domain.reg_type]),
      notes: compactText([
        domain.register_date ? `Registered: ${normalizeDate(domain.register_date)}` : "",
        domain.order_id ? `Order: ${domain.order_id}` : "",
        domain.privacy_protection != null ? `Privacy protection: ${domain.privacy_protection}` : "",
      ]),
      source: ["huawei-domain"],
    };

    byName.set(name, existing ? mergeDomainRecord(existing, domainPayload) : domainPayload);
  }

  for (const zone of huaweiDnsDomains) {
    const name = normalizeDomainName(zone.name);
    if (!name) continue;

    const existing = byName.get(name);
    const zonePayload = {
      name,
      registrar: existing?.registrar || "Unknown",
      dnsProvider: "Huawei Cloud DNS",
      expiresAt: existing?.expiresAt || null,
      autoRenew: Boolean(existing?.autoRenew),
      purpose: zone.description || "DNS zone",
      owner: "Me",
      tags: compactTags(["huawei-cloud", "dns", zone.status, zone.zone_type, ...readHuaweiTags(zone.tags)]),
      notes: compactText([
        zone.record_num != null ? `DNS records: ${zone.record_num}` : "",
        zone.ttl != null ? `TTL: ${zone.ttl}` : "",
        zone.created_at ? `DNS created: ${normalizeDate(zone.created_at)}` : "",
      ]),
      source: ["huawei-dns"],
    };

    byName.set(name, existing ? mergeDomainRecord(existing, zonePayload) : zonePayload);
  }

  return Array.from(byName.values()).sort((a, b) => {
    const aTime = a.expiresAt ? new Date(`${a.expiresAt}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.expiresAt ? new Date(`${b.expiresAt}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.name.localeCompare(b.name);
  });
}

function mergeDomainRecord(existing, incoming) {
  return {
    ...existing,
    registrar: existing.registrar === "Unknown" ? incoming.registrar : existing.registrar,
    dnsProvider: incoming.dnsProvider === "Unknown" ? existing.dnsProvider : incoming.dnsProvider,
    expiresAt: existing.expiresAt || incoming.expiresAt,
    autoRenew: Boolean(existing.autoRenew || incoming.autoRenew),
    purpose: existing.purpose === "DNS zone" ? incoming.purpose : existing.purpose,
    owner: existing.owner || incoming.owner,
    tags: compactTags([...(existing.tags || []), ...(incoming.tags || [])]),
    notes: compactText([existing.notes, incoming.notes]),
    source: compactTags([...(existing.source || []), ...(incoming.source || [])]),
  };
}

async function annotatePublicDnsProviders(domains) {
  const annotated = await Promise.all(
    domains.map(async (domain) => {
      const nameservers = await safeFetch(`public NS for ${domain.name}`, () => resolveNs(domain.name));
      if (!nameservers.length) return domain;

      const provider = inferDnsProviderFromNameservers(nameservers);
      return {
        ...domain,
        dnsProvider: `${provider} (${nameservers.join(", ")})`,
        notes: compactText([domain.notes, `Public NS: ${nameservers.join(", ")}`]),
      };
    }),
  );

  return annotated;
}

function inferDnsProviderFromNameservers(nameservers) {
  const joined = nameservers.join(" ").toLowerCase();
  if (joined.includes("vercel-dns.com")) return "Vercel DNS";
  if (joined.includes("cloudflare.com")) return "Cloudflare";
  if (joined.includes("alidns.com") || joined.includes("hichina.com")) return "Aliyun DNS";
  if (joined.includes("huaweicloud-dns")) return "Huawei Cloud DNS";
  return "External DNS";
}

function normalizeDomainName(value) {
  return String(value || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
}

function normalizeDate(dateText, dateLong) {
  if (dateLong) return new Date(dateLong).toISOString().slice(0, 10);
  if (!dateText) return null;
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function formatDnsProvider(dnsList = []) {
  if (!dnsList.length) return "Unknown";
  const joined = dnsList.join(", ");
  if (dnsList.some((server) => server.toLowerCase().includes("alidns"))) {
    return `Aliyun DNS (${joined})`;
  }
  return joined;
}

function readTags(tags = []) {
  return tags.flatMap((tag) => [tag.key, tag.value]).filter(Boolean);
}

function readHuaweiTags(tags = []) {
  return tags.flatMap((tag) => [tag.key, tag.value]).filter(Boolean);
}

function readNextMarker(nextUrl) {
  if (!nextUrl) return undefined;
  try {
    return new URL(nextUrl).searchParams.get("marker") || undefined;
  } catch {
    return undefined;
  }
}

function compactTags(tags) {
  return Array.from(
    new Set(
      tags
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .map((tag) => tag.replace(/\s+/g, " ")),
    ),
  );
}

function compactText(parts) {
  const text = parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" | ");
  return text || undefined;
}

function formatError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
