import { create } from 'zustand';

interface MonitorState {
  isMonitoring: boolean;
  currentIP: string;
  lastCheck: Date | null;
  setMonitoring: (isMonitoring: boolean) => void;
  setCurrentIP: (ip: string) => void;
  setLastCheck: (date: Date) => void;
  startMonitor: () => void;
  stopMonitor: () => void;
}

export const useMonitorStore = create<MonitorState>((set) => ({
  isMonitoring: false,
  currentIP: '',
  lastCheck: null,
  setMonitoring: (isMonitoring) => set({ isMonitoring }),
  setCurrentIP: (ip) => set({ currentIP: ip }),
  setLastCheck: (date) => set({ lastCheck: date }),
  startMonitor: () => set({ isMonitoring: true }),
  stopMonitor: () => set({ isMonitoring: false }),
}));
