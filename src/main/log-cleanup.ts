export interface LogCleanupPlan {
  deleteAll: boolean;
  cutoffDate: Date | null;
  persistAuditToDatabase: boolean;
}

export const MIN_LOG_RETENTION_DAYS = 7;

export const createLogCleanupPlan = (now: Date, daysToKeep: number): LogCleanupPlan => {
  // 0 是界面“清理全部”的显式全量清理；其余保留天数下限 7 天，与应用设置一致。
  if (
    !Number.isInteger(daysToKeep) ||
    (daysToKeep !== 0 && daysToKeep < MIN_LOG_RETENTION_DAYS) ||
    daysToKeep > 3650
  )
    throw new Error(`无效日志保留天数：需为 0（全部清理）或 ${MIN_LOG_RETENTION_DAYS}-3650 天`);
  if (daysToKeep === 0) {
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
