import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, posix, relative, resolve, sep } from "node:path";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const distDirectory = resolve("dist");
const serverDirectory = resolve("dist", "server");

async function collectAssets(directory) {
  const entries = await readdir(directory);
  const assets = {};

  for (const entry of entries) {
    if (entry === "server") continue;

    const absolutePath = join(directory, entry);
    const info = await stat(absolutePath);

    if (info.isDirectory()) {
      Object.assign(assets, await collectAssets(absolutePath));
      continue;
    }

    const relativePath = relative(distDirectory, absolutePath).split(sep).join(posix.sep);
    assets[`/${relativePath}`] = {
      body: (await readFile(absolutePath)).toString("base64"),
      contentType: contentTypes[extname(entry)] || "application/octet-stream",
    };
  }

  return assets;
}

const assets = await collectAssets(distDirectory);
const worker = `const assets = ${JSON.stringify(assets)};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getAsset(pathname) {
  const normalized = pathname.endsWith("/") ? pathname + "index.html" : pathname;
  return assets[normalized] || assets[pathname];
}

function hasFileExtension(pathname) {
  return pathname.split("/").pop().includes(".");
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const asset = getAsset(url.pathname) || (!hasFileExtension(url.pathname) ? assets["/index.html"] : null);

    if (!asset) {
      return new Response("Not Found", { status: 404 });
    }

    return new Response(request.method === "HEAD" ? null : decodeBase64(asset.body), {
      headers: {
        "content-type": asset.contentType,
      },
    });
  }
};
`;

await mkdir(serverDirectory, { recursive: true });
await writeFile(resolve(serverDirectory, "index.js"), worker);
