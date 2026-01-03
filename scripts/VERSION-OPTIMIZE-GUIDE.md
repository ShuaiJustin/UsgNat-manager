# 版本号显示优化方案

## 问题说明

当前设置页面的版本号是硬编码的，每次更新版本都需要手动修改代码：

```tsx
<p>{t('settings.version')}: V1.0.6</p>
```

这样容易出现版本号不一致的问题（比如 package.json 是 1.0.7，但页面显示 V1.0.6）。

## 优化方案：自动获取版本号

让页面从 Electron 应用自动获取版本号，永远保持一致。

## 实施步骤

### 步骤 1：在 preload.ts 中添加 getVersion 方法

找到 `src/main/preload.ts`，在 `electronAPI` 中添加：

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 现有的 API ...
  
  // 添加获取版本号的方法
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
});
```

### 步骤 2：在 main.ts 中注册 IPC 处理器

找到 `src/main/main.ts`，添加：

```typescript
import { app, ipcMain } from 'electron';

// 注册 IPC 处理器
ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});
```

### 步骤 3：修改 Settings 页面使用动态版本号

找到 `src/renderer/pages/Settings/index.tsx`，修改：

**修改前：**
```tsx
const Settings: React.FC = () => {
  const { t } = useTranslation();
  // ...
  
  return (
    // ...
    <p>{t('settings.version')}: V1.0.6</p>
    // ...
  );
};
```

**修改后：**
```tsx
const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = React.useState('1.0.0');
  
  // 获取应用版本号
  React.useEffect(() => {
    const getVersion = async () => {
      try {
        const api = (window as any).electronAPI;
        if (api?.app?.getVersion) {
          const version = await api.app.getVersion();
          setAppVersion(version);
        }
      } catch (error) {
        console.error('获取版本号失败:', error);
      }
    };
    
    getVersion();
  }, []);
  
  return (
    // ...
    <p>{t('settings.version')}: V{appVersion}</p>
    // ...
  );
};
```

## 完整代码示例

### src/main/preload.ts

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 现有的 API
  device: {
    getAll: () => ipcRenderer.invoke('device:getAll'),
    create: (device: any) => ipcRenderer.invoke('device:create', device),
    update: (id: string, device: any) => ipcRenderer.invoke('device:update', id, device),
    delete: (id: string) => ipcRenderer.invoke('device:delete', id),
  },
  
  // ... 其他 API ...
  
  // 新增：应用信息 API
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
  },
});
```

### src/main/main.ts

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
// ... 其他导入 ...

// 创建窗口的代码...

// 注册 IPC 处理器
function registerIpcHandlers() {
  // 获取应用版本
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });
  
  // ... 其他 IPC 处理器 ...
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});
```

### src/renderer/pages/Settings/index.tsx

```tsx
import React from 'react';
import { Form, Input, Button, Card, Space, Divider, Tabs, message } from 'antd';
import { useTranslation } from 'react-i18next';

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = React.useState('加载中...');
  
  // 获取应用版本号
  React.useEffect(() => {
    const getVersion = async () => {
      try {
        const api = (window as any).electronAPI;
        if (api?.app?.getVersion) {
          const version = await api.app.getVersion();
          setAppVersion(version);
        } else {
          setAppVersion('未知');
        }
      } catch (error) {
        console.error('获取版本号失败:', error);
        setAppVersion('获取失败');
      }
    };
    
    getVersion();
  }, []);
  
  // ... 其他代码 ...
  
  return (
    <div>
      <Form layout="vertical">
        <Tabs
          items={[
            // ... 其他选项卡 ...
            {
              key: '4',
              label: t('settings.about'),
              children: (
                <>
                  <Card title={t('settings.about')}>
                    <p>
                      <strong>{t('settings.aboutTitle')}</strong>
                    </p>
                    <p>{t('settings.version')}: V{appVersion}</p>
                    <p>{t('settings.electronVersion')}: 28.1.0</p>
                    <p>{t('settings.reactVersion')}: 18.2.0</p>
                    <Divider />
                    <Space>
                      <Button onClick={handleViewLicense}>{t('settings.viewLicense')}</Button>
                      <Button onClick={handleCheckUpdate}>{t('settings.checkUpdate')}</Button>
                      <Button onClick={handleContactSupport}>{t('settings.contactSupport')}</Button>
                    </Space>
                  </Card>
                </>
              ),
            },
          ]}
        />
      </Form>
    </div>
  );
};

export default Settings;
```

## 优点

✅ **自动同步**：版本号永远和 package.json 保持一致  
✅ **减少维护**：不需要手动修改页面代码  
✅ **避免错误**：消除版本号不一致的问题  
✅ **统一管理**：只需要修改 package.json 一个地方  

## 使用流程

实施优化后，更新版本号的流程：

```bash
# 1. 只需要运行版本更新脚本
npm run version:update 1.0.8

# 2. 重新构建
npm run build

# 3. 页面自动显示新版本号 ✨
```

## 注意事项

1. 修改完 preload.ts 后需要重新编译
2. 确保在 main.ts 中正确注册了 IPC 处理器
3. 可以在其他需要显示版本号的地方复用这个方法

## 当前工具

如果暂时不想实施优化方案，可以继续使用版本更新脚本：

```bash
npm run version:update 1.0.8
```

脚本会同时更新：
- package.json
- Settings 页面的硬编码版本号

