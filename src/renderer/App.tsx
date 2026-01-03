import { ConfigProvider, theme, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import MainLayout from './components/Layout/MainLayout';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Rules from './pages/Rules';
import Automation from './pages/Automation';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import { useAppStore } from './stores/app.store';
import { useMonitorStore } from './stores/monitor.store';
import ErrorBoundary from './components/ErrorBoundary';
import UpdateDialog from './components/UpdateDialog';
import './i18n'; // 导入 i18n 配置
import { useTranslation } from 'react-i18next';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000, // 30秒
    },
  },
});

function App() {
  const language = useAppStore((state) => state.language);
  const initializeFromConfig = useAppStore((state) => state.initializeFromConfig);
  const { startMonitor, stopMonitor } = useMonitorStore();
  const { i18n } = useTranslation();

  // 同步语言到i18n
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  // 启动时加载配置和监控状态
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const api = (window as any).electronAPI;

        // 加载应用配置
        if (api?.config?.get) {
          const appConfig = await api.config.get('app');

          // 初始化应用配置
          if (appConfig) {
            initializeFromConfig({
              scale: appConfig?.scale || '100',
              language: appConfig?.language || 'zh-CN',
            });
          }
        }

        // 同步监控状态
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

    loadConfig();
  }, [initializeFromConfig, startMonitor, stopMonitor]);

  // 监听托盘监控操作（静默执行，不显示消息）
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on || !api?.monitor) return;

    // 启动监控处理器
    const handleMonitorStart = async () => {
      try {
        const result = await api.monitor.start();
        if (result?.success) {
          startMonitor(); // 同步更新store状态
          // 托盘操作静默执行，不显示消息（Dashboard 按钮操作时会显示）
        }
      } catch (error: any) {
        console.error('托盘启动监控失败:', error);
      }
    };

    // 停止监控处理器
    const handleMonitorStop = async () => {
      try {
        const result = await api.monitor.stop();
        if (result?.success) {
          stopMonitor(); // 同步更新store状态
          // 托盘操作静默执行
        }
      } catch (error: any) {
        console.error('托盘停止监控失败:', error);
      }
    };

    // 注册监听器
    api.on('monitor:start', handleMonitorStart);
    api.on('monitor:stop', handleMonitorStop);

    // 清理监听器
    return () => {
      if (api?.off) {
        api.off('monitor:start', handleMonitorStart);
        api.off('monitor:stop', handleMonitorStop);
      }
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
