export type ApiErrorCode =
  | "NETWORK_ERROR"
  | "AUTH_EXPIRED"
  | "UNAUTHORIZED"
  | "INVALID_STATE"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "UNKNOWN";

export type ToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: ToolError };

export type ToolError = {
  code: ApiErrorCode;
  message: string;
  recoverable: boolean;
};

export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: HttpError };

export type HttpError = {
  code: ApiErrorCode;
  message: string;
  status: number;
  recoverable: boolean;
};

export type EngineerRole = "backend" | "frontend" | "mobile";
export type RawLevelStatus = "meet" | "under" | "over";

export type SkillLevel = {
  skill_id: number;
  skill_name: string;
  level: number;
};

export type UncompletedInterview = {
  skill_id: number;
  skill_name: string;
  target_level: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export type UserProfile = {
  uuid: string;
  email: string;
  fullname: string;
  avatar_url: string | null;
  primary_role: EngineerRole;
  focus_role: EngineerRole | null;
  old_level: number | null;
  old_level_text: string | null;
  itfs_skill_levels: SkillLevel[];
  unofficial_itfs_skill_levels: SkillLevel[];
  uncompleted_interviews: UncompletedInterview[];
};

export type InterviewResponse = {
  uuid: string;
  skill_id: number;
  target_level: number;
  status: string;
  raw_level_status: string | null;
  created_at: string;
  updated_at: string;
};

export type QaHistoryResponse = {
  uuid: string;
  interview_id: number;
  user_id: number;
  question: string;
  question_category: string;
  answer: string | null;
  answered_at: string | null;
  evaluation: string | null;
  meet_level: string | null;
  reason: string | null;
  score: number | null;
  tokens_count: number | null;
  questioned_at: string;
  created_at: string;
  updated_at: string;
};

export type GetProfileInput = void;
export type GetProfileOutput = UserProfile;

export type UpdateProfileInput = {
  focus_role?: EngineerRole | null;
  old_level?: number | null;
  primary_role?: EngineerRole;
};
export type UpdateProfileOutput = UserProfile;

export type InterviewStartInput = {
  skill_id: number;
  target_level: string;
};
export type InterviewStartOutput = {
  skill_name: string;
  target_level: string;
};

export type AskQuestionInput = {
  skill_name: string;
  target_level: string;
  question: string;
  question_category: string;
};
export type AskQuestionOutput = { qa_uuid: string };

export type RecordAnswerInput = { answer: string };
export type RecordAnswerOutput = { qa_uuid: string; answered_at: string };

export type ScoreAnswerInput = {
  score: number;
  meet_level: string;
  reason: string;
  tokens_count?: number;
};
export type ScoreAnswerOutput = { qa_uuid: string };

export type RecordSkipInput = void;
export type RecordSkipOutput = { qa_uuid: string };

export type LockSkillInput = {
  skill_name: string;
  level: string;
  raw_level_status: RawLevelStatus;
};
export type LockSkillOutput = {
  skill_name: string;
  level: string;
  raw_level_status: string;
};

export type CancelInterviewInput = void;
export type CancelInterviewOutput = { status: "canceled" };

export type ResetInput = { error_reason: string };
export type ResetOutput = { status: "error" };
