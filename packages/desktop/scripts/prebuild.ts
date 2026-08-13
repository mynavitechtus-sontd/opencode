#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"

import { downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

// Sync canonical ITFS skill content from the outer itfs-interview repo so the
// embedded built-in skills are not stale. Skipped when the outer repo is not
// present (standalone submodule checkout).
const syncScript = path.resolve(import.meta.dir, "../../../../scripts/sync-itfs-skills.mjs")
if (await Bun.file(syncScript).exists()) {
  await $`bun ${syncScript}`
}

await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await $`cd ../opencode && bun script/build-node.ts`
if (channel === "dev") await downloadCliToResources()
