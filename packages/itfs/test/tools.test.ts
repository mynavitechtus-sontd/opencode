import { describe, expect, test, mock } from "bun:test";
import { SessionStateManager } from "../src/session.js";
import {
  createItfsGetProfile,
  createItfsUpdateProfile,
  createItfsInterviewStart,
  createItfsAskQuestion,
  createItfsRecordAnswer,
  createItfsScoreAnswer,
  createItfsRecordSkip,
  createItfsLockSkill,
  createItfsCancelInterview,
  createItfsReset,
} from "../src/tools.js";

function mockClient(overrides: {
  get?: ReturnType<typeof mock>;
  post?: ReturnType<typeof mock>;
  patch?: ReturnType<typeof mock>;
} = {}) {
  return {
    get: overrides.get ?? mock(async () => ({ ok: true, data: {} })),
    post: overrides.post ?? mock(async () => ({ ok: true, data: {} })),
    patch: overrides.patch ?? mock(async () => ({ ok: true, data: {} })),
  };
}

describe("itfs_get_profile", () => {
  test("calls GET /api/v1/auth/me with user resourceKey and unwraps correctly", async () => {
    const get = mock(async () => ({
      ok: true,
      data: { uuid: "u", email: "a@b.com", fullname: "Test", avatar_url: null, primary_role: "backend", focus_role: null, old_level: null, old_level_text: null, itfs_skill_levels: [], unofficial_itfs_skill_levels: [], uncompleted_interviews: [] },
    }));
    const client = mockClient({ get });
    const tool = createItfsGetProfile(client);

    const result = await tool();

    expect(get).toHaveBeenCalledWith("/api/v1/auth/me", "user");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.uuid).toBe("u");
      expect(result.data.email).toBe("a@b.com");
    }
  });

  test("passes through HTTP errors", async () => {
    const get = mock(async () => ({
      ok: false,
      error: { code: "NETWORK_ERROR" as const, message: "fail", status: 0, recoverable: false },
    }));
    const client = mockClient({ get });
    const tool = createItfsGetProfile(client);

    const result = await tool();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NETWORK_ERROR");
  });
});

describe("itfs_update_profile", () => {
  test("calls PATCH /api/v1/auth/me with user resourceKey", async () => {
    const data = { uuid: "u", email: "a@b.com", fullname: "Test", avatar_url: null, primary_role: "backend" as const, focus_role: null, old_level: null, old_level_text: null, itfs_skill_levels: [], unofficial_itfs_skill_levels: [], uncompleted_interviews: [] };
    const patch = mock(async () => ({ ok: true, data }));
    const client = mockClient({ patch });
    const tool = createItfsUpdateProfile(client);

    const result = await tool({ focus_role: "frontend", old_level: 1, primary_role: "mobile" });

    expect(patch).toHaveBeenCalledWith("/api/v1/auth/me", { focus_role: "frontend", old_level: 1, primary_role: "mobile" }, "user");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual(data);
  });

  test("omits undefined fields from body", async () => {
    const patch = mock(async () => ({
      ok: true,
      data: { uuid: "u", email: "a@b.com", fullname: "Test", avatar_url: null, primary_role: "backend", focus_role: null, old_level: null, old_level_text: null, itfs_skill_levels: [], unofficial_itfs_skill_levels: [], uncompleted_interviews: [] },
    }));
    const client = mockClient({ patch });
    const tool = createItfsUpdateProfile(client);

    await tool({ primary_role: "backend" });

    expect(patch).toHaveBeenCalledWith("/api/v1/auth/me", { primary_role: "backend" }, "user");
  });
});

describe("itfs_interview_start", () => {
  test("rejects if interview already active (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    session.setInterview("existing-uuid");
    const client = mockClient();
    const tool = createItfsInterviewStart(client, session);

    const result = await tool({ skill_id: 1, target_level: "Middle 1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STATE");
      expect(result.error.message).toBe("An interview is already in progress");
    }
  });

  test("creates interview and sets session on success", async () => {
    const session = new SessionStateManager();
    const post = mock(async () => ({ ok: true, data: { uuid: "new-uuid" } }));
    const client = mockClient({ post });
    const tool = createItfsInterviewStart(client, session);

    const result = await tool({ skill_id: 1, target_level: "Middle 1" });

    expect(post).toHaveBeenCalledWith("/api/v1/interviews", { skill_id: 1, target_level: "Middle 1" }, "interview");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.skill_name).toBeDefined();
      expect(result.data.target_level).toBe("Middle 1");
    }
    expect(session.getState().interviewUuid).toBe("new-uuid");
  });

  test("passes through HTTP errors from the API", async () => {
    const session = new SessionStateManager();
    const post = mock(async () => ({
      ok: false,
      error: { code: "SERVER_ERROR" as const, message: "fail", status: 500, recoverable: false },
    }));
    const client = mockClient({ post });
    const tool = createItfsInterviewStart(client, session);

    const result = await tool({ skill_id: 1, target_level: "Middle 1" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SERVER_ERROR");
    expect(session.getState().interviewUuid).toBeNull();
  });
});

describe("itfs_ask_question", () => {
  test("rejects if no active interview (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    const client = mockClient();
    const tool = createItfsAskQuestion(client, session);

    const result = await tool({ skill_name: "Ruby", target_level: "Middle 1", question: "Q", question_category: "algo" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_STATE");
      expect(result.error.message).toBe("No active interview");
    }
  });

  test("creates QA and sets session QA UUID on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const post = mock(async () => ({ ok: true, data: { uuid: "qa-uuid" } }));
    const client = mockClient({ post });
    const tool = createItfsAskQuestion(client, session);

    const result = await tool({ skill_name: "Ruby", target_level: "Middle 1", question: "Q", question_category: "algo" });

    expect(post).toHaveBeenCalledWith(
      "/api/v1/qa_histories",
      { question: "Q", question_category: "algo", interview_uuid: "interview-uuid" },
      "qa_history",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.qa_uuid).toBe("qa-uuid");
    expect(session.getState().currentQaUuid).toBe("qa-uuid");
  });
});

describe("itfs_record_answer", () => {
  test("rejects if no active QA (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const client = mockClient();
    const tool = createItfsRecordAnswer(client, session);

    const result = await tool({ answer: "my answer" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_STATE");
  });

  test("patches correct URL and body on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    session.setQA("qa-uuid");
    const patch = mock(async () => ({ ok: true, data: { uuid: "qa-uuid", answered_at: "2025-01-01T00:00:00Z" } }));
    const client = mockClient({ patch });
    const tool = createItfsRecordAnswer(client, session);

    const result = await tool({ answer: "my answer" });

    expect(patch).toHaveBeenCalledWith("/api/v1/qa_histories/qa-uuid", { answer: "my answer" }, "qa_history");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.qa_uuid).toBe("qa-uuid");
      expect(result.data.answered_at).toBe("2025-01-01T00:00:00Z");
    }
  });
});

describe("itfs_score_answer", () => {
  test("rejects if no active QA (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const client = mockClient();
    const tool = createItfsScoreAnswer(client, session);

    const result = await tool({ score: 3, meet_level: "meet", reason: "good" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_STATE");
  });

  test("sends score params and clears QA on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    session.setQA("qa-uuid");
    const patch = mock(async () => ({ ok: true, data: { uuid: "qa-uuid" } }));
    const client = mockClient({ patch });
    const tool = createItfsScoreAnswer(client, session);

    const result = await tool({ score: 3, meet_level: "meet", reason: "good" });

    expect(patch).toHaveBeenCalledWith(
      "/api/v1/qa_histories/qa-uuid",
      { score: 3, meet_level: "meet", reason: "good", evaluation: "good" },
      "qa_history",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.qa_uuid).toBe("qa-uuid");
    expect(session.getState().currentQaUuid).toBeNull();
  });

  test("includes tokens_count when provided", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    session.setQA("qa-uuid");
    const patch = mock(async () => ({ ok: true, data: { uuid: "qa-uuid" } }));
    const client = mockClient({ patch });
    const tool = createItfsScoreAnswer(client, session);

    await tool({ score: 5, meet_level: "over", reason: "excellent", tokens_count: 150 });

    expect(patch).toHaveBeenCalledWith(
      "/api/v1/qa_histories/qa-uuid",
      { score: 5, meet_level: "over", reason: "excellent", evaluation: "excellent", tokens_count: 150 },
      "qa_history",
    );
  });
});

describe("itfs_record_skip", () => {
  test("rejects if no active QA (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const client = mockClient();
    const tool = createItfsRecordSkip(client, session);

    const result = await tool();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_STATE");
  });

  test("sends skip data and clears QA on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    session.setQA("qa-uuid");
    const patch = mock(async () => ({ ok: true, data: { uuid: "qa-uuid" } }));
    const client = mockClient({ patch });
    const tool = createItfsRecordSkip(client, session);

    const result = await tool();

    expect(patch).toHaveBeenCalledWith(
      "/api/v1/qa_histories/qa-uuid",
      { score: 0, meet_level: "skip", reason: "Skipped", evaluation: "Skipped" },
      "qa_history",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.qa_uuid).toBe("qa-uuid");
    expect(session.getState().currentQaUuid).toBeNull();
  });
});

describe("itfs_lock_skill", () => {
  test("rejects if no active interview (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    const client = mockClient();
    const tool = createItfsLockSkill(client, session);

    const result = await tool({ skill_name: "Ruby", level: "Middle 1", raw_level_status: "meet" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_STATE");
  });

  test("sends completed + raw_level_status and clears session on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const patch = mock(async () => ({ ok: true, data: { status: "completed", raw_level_status: "meet" } }));
    const client = mockClient({ patch });
    const tool = createItfsLockSkill(client, session);

    const result = await tool({ skill_name: "Ruby", level: "Middle 1", raw_level_status: "meet" });

    expect(patch).toHaveBeenCalledWith(
      "/api/v1/interviews/interview-uuid",
      { status: "completed", raw_level_status: "meet" },
      "interview",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.skill_name).toBe("Ruby");
      expect(result.data.level).toBe("Middle 1");
      expect(result.data.raw_level_status).toBe("meet");
    }
    expect(session.getState().interviewUuid).toBeNull();
    expect(session.getState().currentQaUuid).toBeNull();
  });
});

describe("itfs_cancel_interview", () => {
  test("rejects if no active interview (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    const client = mockClient();
    const tool = createItfsCancelInterview(client, session);

    const result = await tool();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_STATE");
  });

  test("sends canceled status and clears session on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const patch = mock(async () => ({ ok: true, data: { status: "canceled" } }));
    const client = mockClient({ patch });
    const tool = createItfsCancelInterview(client, session);

    const result = await tool();

    expect(patch).toHaveBeenCalledWith(
      "/api/v1/interviews/interview-uuid",
      { status: "canceled" },
      "interview",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("canceled");
    expect(session.getState().interviewUuid).toBeNull();
  });
});

describe("itfs_reset", () => {
  test("rejects if no active interview (INVALID_STATE)", async () => {
    const session = new SessionStateManager();
    const client = mockClient();
    const tool = createItfsReset(client, session);

    const result = await tool();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_STATE");
  });

  test("sends error status and clears session on success", async () => {
    const session = new SessionStateManager();
    session.setInterview("interview-uuid");
    const patch = mock(async () => ({ ok: true, data: { status: "error" } }));
    const client = mockClient({ patch });
    const tool = createItfsReset(client, session);

    const result = await tool();

    expect(patch).toHaveBeenCalledWith(
      "/api/v1/interviews/interview-uuid",
      { status: "error" },
      "interview",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("error");
    expect(session.getState().interviewUuid).toBeNull();
  });
});
