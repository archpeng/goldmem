export const apiRouteContract = {
  elder: {
    createTextNote: "POST /elder/text-notes",
    createVoiceNote: "POST /elder/voice-notes",
    queryMemory: "POST /elder/query",
    listReminders: "GET /elder/reminders",
    confirmReminder: "POST /elder/reminders/:id/confirm",
    sendFeedback: "POST /elder/feedback",
  },
  family: {
    todaySummary: "GET /family/elders/:elderId/today-summary",
    pendingTasks: "GET /family/elders/:elderId/pending-tasks",
    confirmTask: "POST /family/tasks/:taskId/confirm",
    createRemoteReminder: "POST /family/reminders",
    sendFeedback: "POST /family/feedback",
  },
} as const;

export type ApiRouteContract = typeof apiRouteContract;
