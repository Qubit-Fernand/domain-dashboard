import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import "dotenv/config";
import * as Alidns from "@alicloud/alidns20150109";
import * as Domain from "@alicloud/domain20180129";
import OpenApi from "@alicloud/openapi-client";
import Util from "@alicloud/tea-util";

const outputPath = resolve("public/domains.json");
const snapshotPath = resolve("data/domains-snapshot.json");
const pageSize = 100;

const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

if (!accessKeyId || !accessKeySecret) {
  console.error("Missing ALIYUN_ACCESS_KEY_ID or ALIYUN_ACCESS_KEY_SECRET in .env.");
  process.exit(1);
}

const config = new OpenApi.Config({
  accessKeyId,
  accessKeySecret,
  regionId: process.env.ALIYUN_REGION_ID || "cn-hangzhou",
});

const DomainClient = Domain.default.default;
const DnsClient = Alidns.default.default;
const domainClient = new DomainClient(config);
const dnsClient = new DnsClient(config);
const runtime = new Util.RuntimeOptions({
  connectTimeout: 10000,
  readTimeout: 20000,
  autoretry: true,
  maxAttempts: 2,
});

const [registeredDomains, dnsDomains] = await Promise.all([
  fetchRegisteredDomains(),
  fetchDnsDomains(),
]);

const merged = mergeDomains(registeredDomains, dnsDomains);

await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(snapshotPath), { recursive: true });

const payload = `${JSON.stringify(merged, null, 2)}\n`;
await writeFile(outputPath, payload);
await writeFile(snapshotPath, payload);

console.log(`Fetched ${registeredDomains.length} Aliyun registered domains.`);
console.log(`Fetched ${dnsDomains.length} Aliyun DNS domains.`);
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${snapshotPath}`);

async function fetchRegisteredDomains() {
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

async function fetchDnsDomains() {
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

function mergeDomains(registeredDomains, dnsDomains) {
  const byName = new Map();

  for (const domain of registeredDomains) {
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

  for (const domain of dnsDomains) {
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

  return Array.from(byName.values()).sort((a, b) => {
    const aTime = a.expiresAt ? new Date(`${a.expiresAt}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.expiresAt ? new Date(`${b.expiresAt}T00:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime || a.name.localeCompare(b.name);
  });
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
