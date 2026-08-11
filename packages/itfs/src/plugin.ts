import type { ApiClient } from "./api-client.js"
import { SessionStateManager } from "./session.js"
import { createItfsGetProfile, createItfsUpdateProfile } from "./tools.js"
import { createItfsInterviewStart, createItfsAskQuestion } from "./tools.js"
import { createItfsRecordAnswer, createItfsScoreAnswer, createItfsRecordSkip } from "./tools.js"
import { createItfsLockSkill, createItfsCancelInterview, createItfsReset } from "./tools.js"
import { createItfsGetSkills } from "./tools.js"
import { createAddInteractionLog } from "./interaction-log.js"
import type { InteractionEvent } from "./interaction-log.js"

export type ItfsPluginDeps = {
  client: ApiClient
}

export function createItfsPlugin(deps: ItfsPluginDeps) {
  const session = new SessionStateManager()
  const { client } = deps

  let skillCache: Record<number, string> | null = null

  const getSkillName = (id: number): string | undefined => {
    if (!skillCache) return `skill-${id}`
    return skillCache[id]
  }

  const itfs_get_skills = async () => {
    const result = await createItfsGetSkills(client)()
    if (result.ok) {
      skillCache = Object.fromEntries(result.data.map((s) => [s.id, s.name]))
    }
    return result
  }

  return {
    tools: {
      itfs_get_profile: createItfsGetProfile(client),
      itfs_update_profile: createItfsUpdateProfile(client),
      itfs_get_skills,
      itfs_interview_start: createItfsInterviewStart(client, session, getSkillName),
      itfs_ask_question: createItfsAskQuestion(client, session),
      itfs_record_answer: createItfsRecordAnswer(client, session),
      itfs_score_answer: createItfsScoreAnswer(client, session),
      itfs_record_skip: createItfsRecordSkip(client, session),
      itfs_lock_skill: createItfsLockSkill(client, session),
      itfs_cancel_interview: createItfsCancelInterview(client, session),
      itfs_reset: createItfsReset(client, session),
    },
    addInteractionLog: createAddInteractionLog(client),
    session,
  } as const
}

export type ItfsPlugin = ReturnType<typeof createItfsPlugin>
