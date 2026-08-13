import { $ } from "bun"
import path from "node:path"

import { downloadCliToResources } from "./utils"

// Sync canonical ITFS skill content from the outer itfs-interview repo so the
// embedded built-in skills are not stale. Skipped when the outer repo is not
// present (standalone submodule checkout).
const syncScript = path.resolve(import.meta.dir, "../../../../scripts/sync-itfs-skills.mjs")
if (await Bun.file(syncScript).exists()) {
  await $`bun ${syncScript}`
}

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await $`cd ../opencode && bun script/build-node.ts`
await downloadCliToResources()
