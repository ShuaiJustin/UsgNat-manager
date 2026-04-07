import { useEffect } from 'react';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AutomationConfirmDialog from './components/AutomationConfirmDialog';
import ErrorBoundary from './components/ErrorBoundary';
import MainLayout from './components/Layout/MainLayout';
import UpdateDialog from './components/UpdateDialog';
import './i18n';
import Automation from './pages/Automation';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Logs from './pages/Logs';
import Rules from './pages/Rules';
import Settings from './pages/Settings';
import { useAppStore } from './stores/app.store';
import type { LanguageType } from './stores/app.store';
import { useMonitorStore } from './stores/monitor.store';
import { startMonitoringService, stopMonitoringService } from './utils/monitorControl';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

function App() {
  const language = useAppStore((state) => state.language);
  const initializeFromConfig = useAppStore((state) => state.initializeFromConfig);
  const { startMonitor, stopMonitor } = useMonitorStore();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const api = window.electronAPI;

        if (api?.config?.get) {
          const appConfig = await api.config.get<{ scale?: string; language?: LanguageType }>(
            'app'
          );
          if (appConfig) {
            initializeFromConfig({
              scale: appConfig.scale || '100',
              language: appConfig.language || 'zh-CN',
            });
          }
        }

        if (api?.monitor?.getStatus) {
          const status = await api.monitor.getStatus();
          if (status?.isRunning) {
            startMonitor();
          } else {
            stopMonitor();
          }
        }
      } catch (error) {
        console.error('加载配置失败:', error);
      }
    };

    void loadConfig();
  }, [initializeFromConfig, startMonitor, stopMonitor]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.on || !api?.monitor) {
      return;
    }

    const handleMonitorStart = async () => {
      try {
        const result = await startMonitoringService(api);
        if (result?.success) {
          startMonitor();
          return;
        }

        throw new Error(result?.error || 'monitor start failed');
      } catch (error) {
        console.error('托盘启动监控失败:', error);
      }
    };

    const handleMonitorStop = async () => {
      try {
        const result = await stopMonitoringService(api);
        if (result?.success) {
          stopMonitor();
          return;
        }

        throw new Error(result?.error || 'monitor stop failed');
      } catch (error) {
        console.error('托盘停止监控失败:', error);
      }
    };

    api.on('monitor:start', handleMonitorStart);
    api.on('monitor:stop', handleMonitorStop);

    return () => {
      api.off?.('monitor:start', handleMonitorStart);
      api.off?.('monitor:stop', handleMonitorStop);
    };
  }, [startMonitor, stopMonitor]);

  return (
    <ConfigProvider
      locale={language === 'zh-CN' ? zhCN : enUS}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#d33f2f',
          borderRadius: 6,
          fontSize: 14,
        },
      }}
    >
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <UpdateDialog />
            <AutomationConfirmDialog />
            <HashRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <Routes>
                <Route path="/" element={<MainLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="devices" element={<Devices />} />
                  <Route path="rules" element={<Rules />} />
                  <Route path="automation" element={<Automation />} />
                  <Route path="logs" element={<Logs />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
              </Routes>
            </HashRouter>
          </ErrorBoundary>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  );
}

export default App;
