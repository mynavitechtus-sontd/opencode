import { afterEach, expect, test } from "bun:test"

const pluginUrl = new URL("../../src/plugin/itfs.ts", import.meta.url).href
const originalFetch = globalThis.fetch
const originalTokenPort = process.env.ITFS_TOKEN_PORT
let importCounter = 0

type Tool = { execute(args: Record<string, unknown>, context?: never): Promise<{ output: string }> }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

async function bridge(options: { failCancel?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = []
  process.env.ITFS_TOKEN_PORT = "43123"
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === "/token") return response({ token: "test-token" })

    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method: init?.method ?? "GET", path: url.pathname, body })
    if (url.pathname === "/api/v1/interviews" && init?.method === "POST") {
      return response({ interview: { uuid: "active-uuid" } })
    }
    if (url.pathname.startsWith("/api/v1/interviews/") && init?.method === "PATCH") {
      return options.failCancel ? new Response("interview missing", { status: 404 }) : response({})
    }
    if (url.pathname === "/api/v1/qa_histories" && init?.method === "POST") {
      return response({ qa_history: { uuid: "qa-uuid" } })
    }
    throw new Error(`Unexpected request: ${init?.method} ${url.pathname}`)
  }) as typeof fetch

  const { ItfsPlugin } = await import(`${pluginUrl}?test=${++importCounter}`)
  const hooks = await ItfsPlugin({} as never)
  return { requests, tools: hooks.tool as Record<string, Tool> }
}

async function startInterview(tools: Record<string, Tool>) {
  await tools.itfs_start_interview.execute({ skill_id: 1, target_level: "4" })
}

async function askQuestion(tools: Record<string, Tool>) {
  return tools.itfs_ask_question.execute({
    skill_name: "Ruby",
    target_level: "4",
    question: "What is a module?",
    question_category: "knowledge",
  })
}

function parsed(result: { output: string }) {
  return JSON.parse(result.output)
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalTokenPort === undefined) delete process.env.ITFS_TOKEN_PORT
  else process.env.ITFS_TOKEN_PORT = originalTokenPort
})

test("uses the active UUID and clears bridge state when cancellation UUID is omitted", async () => {
  const { requests, tools } = await bridge()
  await startInterview(tools)

  await tools.itfs_cancel_interview.execute({})

  expect(requests.filter((request) => request.method === "PATCH")).toEqual([
    { method: "PATCH", path: "/api/v1/interviews/active-uuid", body: { status: "canceled" } },
  ])
  expect(parsed(await askQuestion(tools))).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } })
})

test("uses an explicit active UUID and clears bridge state", async () => {
  const { requests, tools } = await bridge()
  await startInterview(tools)

  await tools.itfs_cancel_interview.execute({ interview_uuid: "active-uuid" })

  expect(requests.filter((request) => request.method === "PATCH")).toEqual([
    { method: "PATCH", path: "/api/v1/interviews/active-uuid", body: { status: "canceled" } },
  ])
  expect(parsed(await askQuestion(tools))).toMatchObject({ ok: false, error: { code: "INVALID_STATE" } })
})

test("cancels an explicit orphan UUID without clearing an active bridge session", async () => {
  const { requests, tools } = await bridge()
  await startInterview(tools)

  await tools.itfs_cancel_interview.execute({ interview_uuid: "orphan-uuid" })

  expect(requests.filter((request) => request.method === "PATCH")).toEqual([
    { method: "PATCH", path: "/api/v1/interviews/orphan-uuid", body: { status: "canceled" } },
  ])
  expect(parsed(await askQuestion(tools))).toMatchObject({ ok: true, data: { qa_uuid: "qa-uuid" } })
})

test("preserves active bridge state when explicit cancellation fails", async () => {
  const { requests, tools } = await bridge({ failCancel: true })
  await startInterview(tools)

  expect(parsed(await tools.itfs_cancel_interview.execute({ interview_uuid: "active-uuid" }))).toMatchObject({
    ok: false,
    error: { code: "SERVER_ERROR", message: "interview missing" },
  })
  expect(parsed(await askQuestion(tools))).toMatchObject({ ok: true, data: { qa_uuid: "qa-uuid" } })
})

test("cancels an explicit orphan UUID without an active bridge session", async () => {
  const { requests, tools } = await bridge()

  await tools.itfs_cancel_interview.execute({ interview_uuid: "orphan-uuid" })

  expect(requests.filter((request) => request.method === "PATCH")).toEqual([
    { method: "PATCH", path: "/api/v1/interviews/orphan-uuid", body: { status: "canceled" } },
  ])
})
