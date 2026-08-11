import type { ApiClient } from "./api-client.js";

export type InteractionEvent = {
  qa_uuid: string;
  event_type: "typing" | "blur" | "copy" | "paste";
  metadata?: Record<string, unknown>;
};

export function createAddInteractionLog(client: ApiClient) {
  return (event: InteractionEvent): Promise<void> => {
    return client.post("/api/v1/qa_interaction_logs", {
      qa_history_uuid: event.qa_uuid,
      log_type: event.event_type,
    }).then(() => {});
  };
}
