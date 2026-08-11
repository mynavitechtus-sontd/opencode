import type { ApiClient } from "./api-client.js";
import type { SessionStateManager } from "./session.js";
import type {
  AskQuestionInput,
  AskQuestionOutput,
  CancelInterviewInput,
  CancelInterviewOutput,
  GetProfileOutput,
  InterviewStartInput,
  InterviewStartOutput,
  LockSkillInput,
  LockSkillOutput,
  RecordAnswerInput,
  RecordAnswerOutput,
  RecordSkipOutput,
  ResetInput,
  ResetOutput,
  ScoreAnswerInput,
  ScoreAnswerOutput,
  ToolResult,
  UpdateProfileInput,
  UpdateProfileOutput,
  UserProfile,
} from "./types.js";

function checkNoInterview(session: SessionStateManager): ToolResult<never> | null {
  try {
    session.requireNoInterview();
    return null;
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: e instanceof Error ? e.message : "An interview is already in progress",
        recoverable: true,
      },
    };
  }
}

function checkInterview(session: SessionStateManager): ToolResult<never> | null {
  try {
    session.requireInterview();
    return null;
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: e instanceof Error ? e.message : "No active interview",
        recoverable: true,
      },
    };
  }
}

function checkQA(session: SessionStateManager): ToolResult<never> | null {
  try {
    session.requireQA();
    return null;
  } catch (e) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: e instanceof Error ? e.message : "No active QA record",
        recoverable: true,
      },
    };
  }
}

export function createItfsGetProfile(client: ApiClient) {
  return async (): Promise<ToolResult<GetProfileOutput>> => {
    const result = await client.get<UserProfile>("/api/v1/auth/me", "user");
    if (!result.ok) return result;
    return { ok: true, data: result.data };
  };
}

export function createItfsUpdateProfile(client: ApiClient) {
  return async (input: UpdateProfileInput): Promise<ToolResult<UpdateProfileOutput>> => {
    const body: Record<string, unknown> = {};
    if (input.focus_role !== undefined) body.focus_role = input.focus_role;
    if (input.old_level !== undefined) body.old_level = input.old_level;
    if (input.primary_role !== undefined) body.primary_role = input.primary_role;

    const result = await client.patch<UserProfile>("/api/v1/auth/me", body, "user");
    if (!result.ok) return result;
    return { ok: true, data: result.data };
  };
}

export function createItfsInterviewStart(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (input: InterviewStartInput): Promise<ToolResult<InterviewStartOutput>> => {
    const stateErr = checkNoInterview(session);
    if (stateErr) return stateErr;

    const result = await client.post<{ uuid: string }>(
      "/api/v1/interviews",
      { skill_id: input.skill_id, target_level: input.target_level },
      "interview",
    );
    if (!result.ok) return result;

    session.setInterview(result.data.uuid);
    return {
      ok: true,
      data: {
        // TODO: map skill_id to skill_name; backend does not return skill_name
        skill_name: input.skill_id as unknown as string,
        target_level: input.target_level,
      },
    };
  };
}

export function createItfsAskQuestion(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (input: AskQuestionInput): Promise<ToolResult<AskQuestionOutput>> => {
    const stateErr = checkInterview(session);
    if (stateErr) return stateErr;

    const result = await client.post<{ uuid: string }>(
      "/api/v1/qa_histories",
      {
        question: input.question,
        question_category: input.question_category,
        interview_uuid: session.getState().interviewUuid,
      },
      "qa_history",
    );
    if (!result.ok) return result;

    session.setQA(result.data.uuid);
    return { ok: true, data: { qa_uuid: result.data.uuid } };
  };
}
