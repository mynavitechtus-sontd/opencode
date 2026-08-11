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
  getSkillName: (id: number) => string | undefined,
) {
  return async (input: InterviewStartInput): Promise<ToolResult<InterviewStartOutput>> => {
    const stateErr = checkNoInterview(session);
    if (stateErr) return stateErr;

    const skillName = getSkillName(input.skill_id);
    if (!skillName) {
      return {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: `Unknown skill id: ${input.skill_id}`, recoverable: true },
      };
    }

    const result = await client.post<{ uuid: string }>(
      "/api/v1/interviews",
      { skill_id: input.skill_id, target_level: input.target_level },
      "interview",
    );
    if (!result.ok) return result;

    session.setInterview(result.data.uuid);
    return {
      ok: true,
      data: { skill_name: skillName, target_level: input.target_level },
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

export function createItfsRecordAnswer(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (input: RecordAnswerInput): Promise<ToolResult<RecordAnswerOutput>> => {
    const stateErr = checkQA(session);
    if (stateErr) return stateErr;

    const result = await client.patch<{ uuid: string; answered_at: string }>(
      `/api/v1/qa_histories/${session.getState().currentQaUuid}`,
      { answer: input.answer },
      "qa_history",
    );
    if (!result.ok) return result;

    return {
      ok: true,
      data: {
        qa_uuid: result.data.uuid,
        answered_at: result.data.answered_at,
      },
    };
  };
}

export function createItfsScoreAnswer(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (input: ScoreAnswerInput): Promise<ToolResult<ScoreAnswerOutput>> => {
    const stateErr = checkQA(session);
    if (stateErr) return stateErr;

    const body: Record<string, unknown> = {
      score: input.score,
      meet_level: input.meet_level,
      reason: input.reason,
      evaluation: input.reason,
    };
    if (input.tokens_count !== undefined) {
      body.tokens_count = input.tokens_count;
    }

    const result = await client.patch<{ uuid: string }>(
      `/api/v1/qa_histories/${session.getState().currentQaUuid}`,
      body,
      "qa_history",
    );
    if (!result.ok) return result;

    session.setQA(null);
    return { ok: true, data: { qa_uuid: result.data.uuid } };
  };
}

export function createItfsRecordSkip(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (): Promise<ToolResult<RecordSkipOutput>> => {
    const stateErr = checkQA(session);
    if (stateErr) return stateErr;

    const result = await client.patch<{ uuid: string }>(
      `/api/v1/qa_histories/${session.getState().currentQaUuid}`,
      { score: 0, meet_level: "skip", reason: "Skipped", evaluation: "Skipped" },
      "qa_history",
    );
    if (!result.ok) return result;

    session.setQA(null);
    return { ok: true, data: { qa_uuid: result.data.uuid } };
  };
}

export function createItfsLockSkill(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (input: LockSkillInput): Promise<ToolResult<LockSkillOutput>> => {
    const stateErr = checkInterview(session);
    if (stateErr) return stateErr;

    const result = await client.patch<{ status: string; raw_level_status: string }>(
      `/api/v1/interviews/${session.getState().interviewUuid}`,
      { status: "completed", raw_level_status: input.raw_level_status },
      "interview",
    );
    if (!result.ok) return result;

    session.clear();
    return {
      ok: true,
      data: {
        skill_name: input.skill_name,
        level: input.level,
        raw_level_status: result.data.raw_level_status,
      },
    };
  };
}

export function createItfsCancelInterview(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (): Promise<ToolResult<CancelInterviewOutput>> => {
    const stateErr = checkInterview(session);
    if (stateErr) return stateErr;

    const result = await client.patch<{ status: string }>(
      `/api/v1/interviews/${session.getState().interviewUuid}`,
      { status: "canceled" },
      "interview",
    );
    if (!result.ok) return result;

    session.clear();
    return { ok: true, data: { status: "canceled" } };
  };
}

export function createItfsReset(
  client: ApiClient,
  session: SessionStateManager,
) {
  return async (input: ResetInput): Promise<ToolResult<ResetOutput>> => {
    const stateErr = checkInterview(session);
    if (stateErr) return stateErr;

    const result = await client.patch<{ status: string }>(
      `/api/v1/interviews/${session.getState().interviewUuid}`,
      { status: "error", error_reason: input.error_reason },
      "interview",
    );
    if (!result.ok) return result;

    session.clear();
    return { ok: true, data: { status: "error" } };
  };
}
