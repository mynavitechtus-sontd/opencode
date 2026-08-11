import type { ApiErrorCode } from "./types.js";

type SessionState = {
  interviewUuid: string | null;
  currentQaUuid: string | null;
};

class StateAssertionError extends Error {
  readonly code: ApiErrorCode = "INVALID_STATE";
  readonly recoverable = true;

  constructor(message: string) {
    super(message);
    this.name = "StateAssertionError";
  }
}

export class SessionStateManager {
  private state: SessionState;

  constructor() {
    this.state = { interviewUuid: null, currentQaUuid: null };
  }

  getState(): Readonly<SessionState> {
    return this.state;
  }

  requireInterview(): asserts this is { state: { interviewUuid: string } } {
    if (this.state.interviewUuid === null) {
      throw new StateAssertionError("No active interview");
    }
  }

  requireQA(): asserts this is { state: { currentQaUuid: string } } {
    if (this.state.currentQaUuid === null) {
      throw new StateAssertionError("No active QA record");
    }
  }

  requireNoInterview(): asserts this is { state: { interviewUuid: null } } {
    if (this.state.interviewUuid !== null) {
      throw new StateAssertionError("An interview is already in progress");
    }
  }

  setInterview(uuid: string): void {
    this.state.interviewUuid = uuid;
  }

  setQA(uuid: string | null): void {
    this.state.currentQaUuid = uuid;
  }

  clear(): void {
    this.state.interviewUuid = null;
    this.state.currentQaUuid = null;
  }
}
