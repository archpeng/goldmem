import type { ElderMemoryKernel } from "@mem/memory-kernel";
import type {
  DebugTraceStore,
  ElderProfileStore,
  EventStore,
  ReminderStore,
} from "@mem/memory-store";

export const apiRouteContract = {
  elder: {
    turn: "POST /elder/turn",
    ingestStatus: "GET /elder/sources/:sourceId/ingest-status",
    listEvents: "GET /elder/events",
    listReminders: "GET /elder/reminders",
    confirmReminder: "POST /elder/reminders/:id/confirm",
    sendFeedback: "POST /elder/feedback",
    getProfile: "GET /elder/profile",
    upsertProfile: "PUT /elder/profile",
    todaySnapshot: "GET /elder/today-snapshot",
  },
  family: {
    pendingTasks: "GET /family/elders/:elderId/pending-tasks",
    confirmTask: "POST /family/tasks/:taskId/confirm",
    rejectTask: "POST /family/tasks/:taskId/reject",
    needsMoreInfoTask: "POST /family/tasks/:taskId/needs-more-info",
    createRemoteReminder: "POST /family/reminders",
  },
  debug: {
    getTrace: "GET /debug/traces/:traceId",
    getSourceTrace: "GET /debug/sources/:sourceId",
    getQueryTrace: "GET /debug/queries/:auditId",
  },
} as const;

export type ApiRouteContract = typeof apiRouteContract;

export type ApiServerDeps = {
  kernel: ElderMemoryKernel;
  eventStore: EventStore;
  reminderStore: ReminderStore;
  elderProfileStore: ElderProfileStore;
  debugTraceStore?: DebugTraceStore;
  debugApi?: {
    token: string;
  };
  healthCheck?: () => Promise<Record<string, unknown>>;
};
