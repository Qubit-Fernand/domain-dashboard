import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("public/domains.json");
const target = resolve("data/domains-snapshot.json");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

console.log(`Wrote ${target}`);
console.log("Next step: replace this placeholder with Aliyun/Huawei Cloud API collectors.");
