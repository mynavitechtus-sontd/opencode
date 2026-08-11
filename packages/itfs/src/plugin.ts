import type { ApiClient } from "./api-client.js";
import { SessionStateManager } from "./session.js";
import { createItfsGetProfile, createItfsUpdateProfile } from "./tools.js";
import { createItfsInterviewStart, createItfsAskQuestion } from "./tools.js";
import { createItfsRecordAnswer, createItfsScoreAnswer, createItfsRecordSkip } from "./tools.js";
import { createItfsLockSkill, createItfsCancelInterview, createItfsReset } from "./tools.js";
import { createAddInteractionLog } from "./interaction-log.js";
import type { InteractionEvent } from "./interaction-log.js";

export type ItfsPluginDeps = {
  client: ApiClient;
};

export function createItfsPlugin(deps: ItfsPluginDeps) {
  const session = new SessionStateManager();
  const { client } = deps;

  return {
    tools: {
      itfs_get_profile: createItfsGetProfile(client),
      itfs_update_profile: createItfsUpdateProfile(client),
      itfs_interview_start: createItfsInterviewStart(client, session),
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
  } as const;
}

export type ItfsPlugin = ReturnType<typeof createItfsPlugin>;
