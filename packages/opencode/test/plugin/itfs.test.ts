import { afterEach, expect, test } from "bun:test"

const pluginUrl = new URL("../../src/plugin/itfs.ts", import.meta.url).href
const originalFetch = globalThis.fetch
const originalTokenPort = process.env.ITFS_TOKEN_PORT
let importCounter = 0

type Tool = { execute(args: Record<string, unknown>, context?: never): Promise<{ output: string }> }

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

async function bridge(options: { completeOnAnswer?: boolean; failCancel?: boolean; failStart?: boolean } = {}) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = []
  process.env.ITFS_TOKEN_PORT = "43123"
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === "/token") return response({ token: "test-token" })

    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ method: init?.method ?? "GET", path: url.pathname, body })
    if (url.pathname === "/api/v1/interviews" && init?.method === "POST") {
      if (options.failStart) return response({ errors: { status: ["an interview is already in progress"] } }, 422)
      return response({ interview: { uuid: "active-uuid" } })
    }
    if (url.pathname.startsWith("/api/v1/interviews/") && init?.method === "PATCH") {
      return options.failCancel ? new Response("interview missing", { status: 404 }) : response({})
    }
    if (url.pathname === "/api/v1/qa_histories" && init?.method === "POST") {
      return response({ qa_history: { uuid: "qa-uuid", question: "Server question?", question_category: "situational" } })
    }
    if (url.pathname.startsWith("/api/v1/qa_histories/") && init?.method === "PATCH") {
      if (options.completeOnAnswer) {
        return response({
          qa_history: {
            uuid: "qa-uuid",
            answered_at: "2026-08-13T10:00:00Z",
            has_more_question: false,
            evaluation: "Đánh giá tốt.",
            interview: { uuid: "active-uuid", status: "completed", target_level: 4, raw_level_status: "meet" },
          },
        })
      }
      return response({
        qa_history: {
          uuid: "qa-uuid",
          answered_at: "2026-08-13T10:00:00Z",
          has_more_question: true,
          evaluation: "Đánh giá tốt.",
          interview: { uuid: "active-uuid", status: "in_progress", target_level: 4, raw_level_status: null },
        },
      })
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
  return tools.itfs_ask_question.execute({})
}

function parsed(result: { output: string }) {
  return JSON.parse(result.output)
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalTokenPort === undefined) delete process.env.ITFS_TOKEN_PORT
  else process.env.ITFS_TOKEN_PORT = originalTokenPort
})

test("start_interview maps an in-progress 422 to INTERVIEW_IN_PROGRESS", async () => {
  const { tools } = await bridge({ failStart: true })

  const result = parsed(await tools.itfs_start_interview.execute({ skill_id: 1, target_level: "4" }))

  expect(result).toMatchObject({ ok: false, error: { code: "INTERVIEW_IN_PROGRESS" } })
})

test("propagates a non-in-progress validation error from start_interview as VALIDATION_ERROR", async () => {
  const originalFetch = globalThis.fetch
  process.env.ITFS_TOKEN_PORT = "43124"
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname === "/token") return response({ token: "test-token" })
    if (url.pathname === "/api/v1/interviews" && init?.method === "POST") {
      return response({ errors: { skill_id: ["can't be blank"] } }, 422)
    }
    throw new Error(`Unexpected request: ${init?.method} ${url.pathname}`)
  }) as typeof fetch
  const { ItfsPlugin } = await import(`${pluginUrl}?test=${++importCounter}`)
  const tools = (await ItfsPlugin({} as never)).tool as Record<string, Tool>

  const result = parsed(await tools.itfs_start_interview.execute({ skill_id: 1, target_level: "4" }))

  expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } })
  globalThis.fetch = originalFetch
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
  expect(parsed(await askQuestion(tools))).toMatchObject({
    ok: true,
    data: { qa_uuid: "qa-uuid", question: "Server question?", question_category: "situational" },
  })
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

test("ask_question posts without a body and returns the server question", async () => {
  const { requests, tools } = await bridge()
  await startInterview(tools)

  const result = parsed(await tools.itfs_ask_question.execute({}))

  expect(requests).toContainEqual({ method: "POST", path: "/api/v1/qa_histories", body: undefined })
  expect(result).toMatchObject({
    ok: true,
    data: { qa_uuid: "qa-uuid", question: "Server question?", question_category: "situational" },
  })
})

test("record_answer surfaces has_more_question, evaluation, and interview and clears the QA uuid", async () => {
  const { tools } = await bridge()
  await startInterview(tools)
  await tools.itfs_ask_question.execute({})

  const result = parsed(await tools.itfs_record_answer.execute({ answer: "Một câu trả lời" }))

  expect(result).toMatchObject({
    ok: true,
    data: {
      qa_uuid: "qa-uuid",
      has_more_question: true,
      evaluation: "Đánh giá tốt.",
      interview: { uuid: "active-uuid", status: "in_progress", target_level: 4, raw_level_status: null },
    },
  })
  expect(parsed(await tools.itfs_record_answer.execute({ answer: "Lại" }))).toMatchObject({
    ok: false,
    error: { code: "INVALID_STATE" },
  })
})

test("record_skip sends skipped true and clears the QA uuid", async () => {
  const { requests, tools } = await bridge()
  await startInterview(tools)
  await tools.itfs_ask_question.execute({})

  const result = parsed(await tools.itfs_record_skip.execute({ skipped: true }))

  expect(requests).toContainEqual({ method: "PATCH", path: "/api/v1/qa_histories/qa-uuid", body: { skipped: true } })
  expect(result).toMatchObject({ ok: true, data: { qa_uuid: "qa-uuid", has_more_question: true } })
  expect(parsed(await tools.itfs_record_skip.execute({ skipped: true }))).toMatchObject({
    ok: false,
    error: { code: "INVALID_STATE" },
  })
})

test("record_answer completion clears the interview uuid so a new skill can start", async () => {
  const { tools } = await bridge({ completeOnAnswer: true })
  await startInterview(tools)
  await askQuestion(tools)

  const result = parsed(await tools.itfs_record_answer.execute({ answer: "X" }))

  expect(result).toMatchObject({
    ok: true,
    data: {
      has_more_question: false,
      interview: { uuid: "active-uuid", status: "completed", target_level: 4, raw_level_status: "meet" },
    },
  })
  expect(parsed(await tools.itfs_start_interview.execute({ skill_id: 2, target_level: "5" }))).toMatchObject({ ok: true })
})

test("record_skip completion clears the interview uuid so a new skill can start", async () => {
  const { tools } = await bridge({ completeOnAnswer: true })
  await startInterview(tools)
  await askQuestion(tools)

  const result = parsed(await tools.itfs_record_skip.execute({ skipped: true }))

  expect(result).toMatchObject({ ok: true, data: { has_more_question: false } })
  expect(parsed(await tools.itfs_start_interview.execute({ skill_id: 2, target_level: "5" }))).toMatchObject({ ok: true })
})

test("removes the score and complete tools from the bridge", async () => {
  const { tools } = await bridge()

  expect(tools.itfs_score_answer).toBeUndefined()
  expect(tools.itfs_complete_interview).toBeUndefined()
})
