import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Sites serves the Vite-generated client files through this Worker entry.
// Keeping it generated makes the normal Vite build the single source of truth.
const serverDirectory = resolve("dist", "server");
const worker = `export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    const url = new URL(request.url);
    if (request.method === "GET" && !url.pathname.split("/").pop().includes(".")) {
      return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
    }

    return response;
  },
};
`;

await mkdir(serverDirectory, { recursive: true });
await writeFile(resolve(serverDirectory, "index.js"), worker);
