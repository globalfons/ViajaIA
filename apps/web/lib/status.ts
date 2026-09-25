export const AGENT_STATUS_VARIANT = { active: "success", draft: "secondary", paused: "warning", archived: "outline" } as const;

export const RUN_STATUS_VARIANT = {
  completed: "success",
  running: "default",
  needs_approval: "warning",
  escalated: "warning",
  blocked: "danger",
  failed: "danger",
} as const;
