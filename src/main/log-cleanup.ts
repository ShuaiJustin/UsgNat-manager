export interface LogCleanupPlan {
  deleteAll: boolean;
  cutoffDate: Date | null;
  persistAuditToDatabase: boolean;
}

export const createLogCleanupPlan = (now: Date, daysToKeep: number): LogCleanupPlan => {
  if (daysToKeep <= 0) {
    return {
      deleteAll: true,
      cutoffDate: null,
      persistAuditToDatabase: false,
    };
  }

  const cutoffDate = new Date(now);
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  return {
    deleteAll: false,
    cutoffDate,
    persistAuditToDatabase: true,
  };
};
