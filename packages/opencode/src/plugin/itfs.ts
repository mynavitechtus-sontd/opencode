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

async function refreshToken(): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false
  const res = await fetch(`${ITFS_API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  })
  return res.ok
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
      const refreshed = await refreshToken()
      if (refreshed) return apiRequest<T>(method, path, body)
      throw { code: "AUTH_EXPIRED", message: "Token refresh failed" }
    }

    if (!res.ok) {
      const msg = await res.text().catch(() => "Request failed")
      throw { code: res.status === 422 ? "VALIDATION_ERROR" : "SERVER_ERROR", message: msg }
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

function unwrap<T>(response: Record<string, T>, key: string): T {
  return (response[key] ?? response) as T
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
  return result({ ok: false, error: { code: "UNKNOWN", message: String(err) } })
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
          old_level: z.number().min(1).max(9).nullable().optional(),
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

      itfs_interview_start: tool({
        description: "Start a new ITFS interview for one skill",
        args: {
          skill_id: z.number().int().positive(),
          target_level: z.string(),
        },
        execute: async (args) => {
          try {
            requireNoInterview()
            const data = await apiRequest<{ interview: { uuid: string } }>("POST", "/api/v1/interviews", {
              skill_id: args.skill_id,
              target_level: args.target_level,
            })
            interviewUuid = data.interview.uuid
            return result({
              ok: true,
              data: { skill_name: `skill-${args.skill_id}`, target_level: args.target_level },
            })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_ask_question: tool({
        description: "Record a question asked during an ITFS interview",
        args: {
          skill_name: z.string(),
          target_level: z.string(),
          question: z.string(),
          question_category: z.string(),
        },
        execute: async (args) => {
          try {
            const iUuid = requireInterview()
            const data = await apiRequest<{ qa_history: { uuid: string } }>("POST", "/api/v1/qa_histories", {
              question: args.question,
              question_category: args.question_category,
              interview_uuid: iUuid,
            })
            currentQaUuid = data.qa_history.uuid
            return result({ ok: true, data: { qa_uuid: data.qa_history.uuid } })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_record_answer: tool({
        description: "Record the user's answer to a question",
        args: { answer: z.string() },
        execute: async (args) => {
          try {
            const qUuid = requireQA()
            const data = await apiRequest<{ qa_history: { uuid: string; answered_at: string } }>(
              "PATCH", `/api/v1/qa_histories/${qUuid}`, { answer: args.answer },
            )
            return result({
              ok: true,
              data: { qa_uuid: data.qa_history.uuid, answered_at: data.qa_history.answered_at },
            })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_score_answer: tool({
        description: "Score an answer with 0-1 rating, meet level, and reason",
        args: {
          score: z.number().min(0).max(1),
          meet_level: z.string(),
          reason: z.string(),
          tokens_count: z.number().int().optional(),
        },
        execute: async (args) => {
          try {
            const qUuid = requireQA()
            const body: Record<string, unknown> = {
              score: args.score,
              meet_level: args.meet_level,
              reason: args.reason,
              evaluation: args.reason,
            }
            if (args.tokens_count !== undefined) body.tokens_count = args.tokens_count
            const data = await apiRequest<{ qa_history: { uuid: string } }>(
              "PATCH", `/api/v1/qa_histories/${qUuid}`, body,
            )
            currentQaUuid = null
            return result({ ok: true, data: { qa_uuid: data.qa_history.uuid } })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_record_skip: tool({
        description: "Mark current question as skipped",
        args: {},
        execute: async () => {
          try {
            const qUuid = requireQA()
            const data = await apiRequest<{ qa_history: { uuid: string } }>(
              "PATCH", `/api/v1/qa_histories/${qUuid}`,
              { score: 0, meet_level: "skip", reason: "Skipped", evaluation: "Skipped" },
            )
            currentQaUuid = null
            return result({ ok: true, data: { qa_uuid: data.qa_history.uuid } })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_lock_skill: tool({
        description: "Finalize a skill assessment and complete the interview",
        args: {
          skill_name: z.string(),
          level: z.string(),
          raw_level_status: z.enum(["meet", "under", "over"]),
        },
        execute: async (args) => {
          try {
            const iUuid = requireInterview()
            await apiRequest<unknown>("PATCH", `/api/v1/interviews/${iUuid}`, {
              status: "completed", raw_level_status: args.raw_level_status,
            })
            interviewUuid = null
            currentQaUuid = null
            return result({
              ok: true,
              data: { skill_name: args.skill_name, level: args.level, raw_level_status: args.raw_level_status },
            })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_cancel_interview: tool({
        description: "Cancel the current interview (user-initiated)",
        args: {},
        execute: async () => {
          try {
            const iUuid = requireInterview()
            await apiRequest<unknown>("PATCH", `/api/v1/interviews/${iUuid}`, { status: "canceled" })
            interviewUuid = null
            currentQaUuid = null
            return result({ ok: true, data: { status: "canceled" } })
          } catch (e) { return handleErr(e) }
        },
      }),

      itfs_reset: tool({
        description: "Reset interview due to stuck state or error",
        args: { error_reason: z.string() },
        execute: async (args) => {
          try {
            const iUuid = requireInterview()
            await apiRequest<unknown>("PATCH", `/api/v1/interviews/${iUuid}`, {
              status: "error", error_reason: args.error_reason,
            })
            interviewUuid = null
            currentQaUuid = null
            return result({ ok: true, data: { status: "error" } })
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
