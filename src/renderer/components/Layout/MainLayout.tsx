import React from 'react';
import { Layout, Menu } from 'antd';
import {
  DashboardOutlined,
  LaptopOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  FileSearchOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import TitleBar from './TitleBar';
import StatusBar from './StatusBar';

const { Sider, Content } = Layout;

const MainLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined style={{ fontSize: 18 }} />,
      label: t('menu.dashboard'),
    },
    {
      key: '/devices',
      icon: <LaptopOutlined style={{ fontSize: 18 }} />,
      label: t('menu.devices'),
    },
    {
      key: '/rules',
      icon: <FileTextOutlined style={{ fontSize: 18 }} />,
      label: t('menu.rules'),
    },
    {
      key: '/automation',
      icon: <ThunderboltOutlined style={{ fontSize: 18 }} />,
      label: t('menu.automation'),
    },
    {
      key: '/logs',
      icon: <FileSearchOutlined style={{ fontSize: 18 }} />,
      label: t('menu.logs'),
    },
    {
      key: '/settings',
      icon: <SettingOutlined style={{ fontSize: 18 }} />,
      label: t('menu.settings'),
    },
  ];

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  return (
    <Layout style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 自定义标题栏 */}
      <TitleBar />

      {/* 顶部状态栏 */}
      <StatusBar />

      <Layout style={{ flex: 1, overflow: 'hidden' }}>
        {/* 侧边导航栏 */}
        <Sider
          width={200}
          style={{
            background: '#fff',
            borderRight: '1px solid #f0f0f0',
            overflow: 'auto',
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={handleMenuClick}
            style={{
              height: '100%',
              borderRight: 0,
              fontSize: 16,
            }}
            className="main-menu"
          />
        </Sider>

        {/* 主内容区 */}
        <Layout style={{ padding: 0, overflow: 'hidden' }}>
          <Content
            style={{
              padding: 24,
              margin: 0,
              minHeight: 280,
              background: '#f5f5f5',
              overflow: 'auto',
              height: '100%',
            }}
          >
            <Outlet />
          </Content>
        </Layout>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
