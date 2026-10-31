type ResolveCurrentMonitorIPOptions = {
  isMonitoring: boolean;
  currentIP: string;
  fetchCurrentIP: () => Promise<string>;
  fallbackIP?: string;
};

export const resolveCurrentMonitorIP = async ({
  isMonitoring,
  currentIP,
  fetchCurrentIP,
  fallbackIP = '',
}: ResolveCurrentMonitorIPOptions): Promise<string> => {
  if (isMonitoring && currentIP) {
    return currentIP;
  }

  try {
    const nextIP = await fetchCurrentIP();
    return nextIP || fallbackIP;
  } catch {
    return fallbackIP;
  }
};
