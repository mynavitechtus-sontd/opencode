import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import { z } from "zod"

const ITFS_API_URL = process.env.ITFS_API_URL ?? "http://localhost:3000"
const TOKEN_PORT = process.env.ITFS_TOKEN_PORT ? parseInt(process.env.ITFS_TOKEN_PORT) : null

function result(data: unknown) {
  return { output: JSON.stringify(data) }
}

async function getAccessToken(): Promise<string | null> {
  if (!TOKEN_PORT) return null
  const res = await fetch(`http://localhost:${TOKEN_PORT}/token`)
  if (!res.ok) return null
  const json = (await res.json()) as { token: string }
  return json.token
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retry = 0,
): Promise<T> {
  const token = await getAccessToken()
  if (!token) throw { code: "AUTH_EXPIRED", message: "No access token" }

  try {
    const res = await fetch(`${ITFS_API_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (res.status === 401) {
      const newToken = await getAccessToken()
      if (newToken) return apiRequest<T>(method, path, body)
      throw { code: "AUTH_EXPIRED", message: "Token expired and refresh failed" }
    }

    if (!res.ok) {
      const msg = await res.text().catch(() => "Request failed")
      let errors: Record<string, unknown> | undefined
      if (res.status === 422) {
        try { errors = (JSON.parse(msg) as { errors?: Record<string, unknown> }).errors } catch { errors = undefined }
      }
      throw { code: res.status === 422 ? "VALIDATION_ERROR" : "SERVER_ERROR", message: msg, errors }
    }

    return (await res.json()) as T
  } catch (err) {
    if (retry < 3 && err instanceof TypeError) {
      await new Promise((r) => setTimeout(r, [1000, 2000, 4000][retry]))
      return apiRequest<T>(method, path, body, retry + 1)
    }
    throw err
  }
}

let interviewUuid: string | null = null
let currentQaUuid: string | null = null

function requireInterview() {
  if (!interviewUuid) throw { code: "INVALID_STATE", message: "No active interview" }
  return interviewUuid
}
function requireQA() {
  if (!currentQaUuid) throw { code: "INVALID_STATE", message: "No active QA record" }
  return currentQaUuid
}
function requireNoInterview() {
  if (interviewUuid) throw { code: "INVALID_STATE", message: "Interview already in progress" }
}

function handleErr(err: unknown) {
  if (err instanceof Error) return result({ ok: false, error: { code: "NETWORK_ERROR", message: err.message } })
  if (typeof err === "object" && err !== null && "code" in err && "message" in err) {
    return result({ ok: false, error: { code: String(err.code), message: String(err.message) } })
  }
  return result({ ok: false, error: { code: "UNKNOWN", message: String(err) } })
}

const LEVEL_NAMES: Record<string, string> = {
  J1: "Junior 1",
  J2: "Junior 2",
  J3: "Junior 3",
  M1: "Middle 1",
  M2: "Middle 2",
  M3: "Middle 3",
  S1: "Senior 1",
  S2: "Senior 2",
  S3: "Senior 3",
}
function levelName(key: string): string {
  return LEVEL_NAMES[key] ?? key
}

export async function ItfsPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    tool: {
      itfs_get_profile: tool({
        description: "Get current user profile from ITFS backend",
        args: {},
        execute: async () => {
          try {
            const data = await apiRequest<{ user: Record<string, unknown> }>("GET", "/api/v1/auth/me")
            return result({ ok: true, data: data.user ?? data })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_update_profile: tool({
        description: "Update current user profile",
        args: {
          focus_role: z.enum(["backend", "frontend", "mobile"]).nullable().optional(),
          old_level: z.enum(["J1", "J2", "J3", "M1", "M2", "M3", "S1", "S2", "S3"]).nullable().optional(),
          primary_role: z.enum(["backend", "frontend", "mobile"]).optional(),
        },
        execute: async (args) => {
          try {
            const body: Record<string, unknown> = {}
            if (args.focus_role !== undefined) body.focus_role = args.focus_role
            if (args.old_level !== undefined) body.old_level = args.old_level
            if (args.primary_role !== undefined) body.primary_role = args.primary_role
            const data = await apiRequest<{ user: Record<string, unknown> }>("PATCH", "/api/v1/auth/me", body)
            return result({ ok: true, data: data.user ?? data })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_get_skills: tool({
        description: "Get list of ITFS skills",
        args: {},
        execute: async () => {
          try {
            const data = await apiRequest<unknown[]>("GET", "/api/v1/skills")
            return result({ ok: true, data })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_start_interview: tool({
        description: "Start a new ITFS interview for a specific skill",
        args: {
          skill_id: z.union([z.number().int().positive(), z.string()]),
          target_level: z.enum(["J1", "J2", "J3", "M1", "M2", "M3", "S1", "S2", "S3"]),
        },
        execute: async (args) => {
          try {
            requireNoInterview()
            const data = await apiRequest<{ interview: { uuid: string; skill: { name: string }; target_level: string } }>(
              "POST", "/api/v1/interviews",
              { skill_id: args.skill_id, target_level: args.target_level },
            )
            interviewUuid = data.interview.uuid
            return result({
              ok: true,
              data: { skill_name: data.interview.skill.name, target_level: levelName(data.interview.target_level) },
            })
          } catch (e) {
            if (typeof e === "object" && e !== null && "errors" in e) {
              const errors = (e as { errors?: Record<string, unknown> }).errors
              if (errors?.status) {
                return result({ ok: false, error: { code: "INTERVIEW_IN_PROGRESS", message: "An interview is already in progress" } })
              }
            }
            return handleErr(e)
          }
        },
      }),

      itfs_ask_question: tool({
        description: "Get the next question generated by the ITFS server for the active interview",
        args: {},
        execute: async () => {
          try {
            requireInterview()
            const data = await apiRequest<{ qa_history: { uuid: string; question: string } }>(
              "POST", "/api/v1/qa_histories",
            )
            currentQaUuid = data.qa_history.uuid
            return result({
              ok: true,
              data: { qa_uuid: data.qa_history.uuid, question: data.qa_history.question },
            })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_record_answer: tool({
        description: "Record the user's answer; the server scores it and may end the interview",
        args: { answer: z.string() },
        execute: async (args) => {
          try {
            const qUuid = requireQA()
            const data = await apiRequest<{
              qa_history: { uuid: string; answered_at: string | null; has_more_question: boolean; interview: { uuid: string } }
            }>(
              "PATCH", `/api/v1/qa_histories/${qUuid}`, { answer: args.answer, answered_at: new Date().toISOString() },
            )
            currentQaUuid = null
            if (data.qa_history.has_more_question === false) interviewUuid = null
            return result({
              ok: true,
              data: {
                qa_uuid: data.qa_history.uuid,
                interview_uuid: data.qa_history.interview.uuid,
                answered_at: data.qa_history.answered_at,
                has_more_question: data.qa_history.has_more_question,
              },
            })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_record_skip: tool({
        description: "Request to change the current question; the server may reject a third skip and require an answer",
        args: { skipped: z.literal(true) },
        execute: async (args) => {
          try {
            const qUuid = requireQA()
            const data = await apiRequest<{ qa_history: { uuid: string; has_more_question: boolean; interview: { uuid: string } } }>(
              "PATCH", `/api/v1/qa_histories/${qUuid}`, { skipped: args.skipped },
            )
            currentQaUuid = null
            if (data.qa_history.has_more_question === false) interviewUuid = null
            return result({
              ok: true,
              data: {
                qa_uuid: data.qa_history.uuid,
                interview_uuid: data.qa_history.interview.uuid,
                has_more_question: data.qa_history.has_more_question,
              },
            })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_cancel_interview: tool({
        description: "Cancel an interview; omit interview_uuid to cancel the active session",
        args: { interview_uuid: z.string().optional() },
        execute: async (args) => {
          try {
            const iUuid = args.interview_uuid ?? requireInterview()
            const data = await apiRequest<{ interview: { status: string } }>(
              "PATCH", `/api/v1/interviews/${iUuid}`, { status: "canceled" },
            )
            if (iUuid === interviewUuid) {
              interviewUuid = null
              currentQaUuid = null
            }
            return result({ ok: true, data: { status: data.interview.status } })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_reset_interview: tool({
        description: "Reset a stuck interview session, setting status to error and clearing session state",
        args: { error_reason: z.string() },
        execute: async (args) => {
          try {
            const iUuid = requireInterview()
            const data = await apiRequest<{ interview: { status: string } }>(
              "PATCH", `/api/v1/interviews/${iUuid}`,
              { status: "error", error_reason: args.error_reason },
            )
            interviewUuid = null
            currentQaUuid = null
            return result({ ok: true, data: { status: data.interview.status } })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_fetch_interview: tool({
        description: "Fetch interview details by uuid; intended to summarize a completed interview returned by itfs_record_answer",
        args: { interview_uuid: z.string().optional() },
        execute: async (args) => {
          try {
            const iUuid = args.interview_uuid ?? interviewUuid
            if (!iUuid) {
              return result({
                ok: false,
                error: { code: "INVALID_STATE", message: "No interview in session or interview not completed" },
              })
            }
            const data = await apiRequest<{ interview: { status: string } & Record<string, unknown> }>(
              "GET", `/api/v1/interviews/${iUuid}`,
            )
            if (data.interview.status !== "completed") {
              return result({ ok: false, error: { code: "INVALID_STATE", message: "Interview not completed" } })
            }
            return result({ ok: true, data: data.interview })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_health_check: tool({
        description: "Check ITFS backend health",
        args: {},
        execute: async () => {
          try {
            const res = await fetch(`${ITFS_API_URL}/health`)
            return result({ ok: true, data: { status: res.status === 200 ? "ok" : "degraded" } })
          } catch {
            return result({ ok: false, error: { code: "NETWORK_ERROR", message: "ITFS backend unreachable" } })
          }
        },
      }),
    },
  }
}
