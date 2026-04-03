# 图标系统文档

## 1. 图标库

本项目使用 **Ant Design Icons** (而非FontAwesome)

- 版本: @ant-design/icons ^5.2.6
- 官方文档: https://ant.design/components/icon-cn/

## 2. 导航菜单图标

```typescript
主控制台 (Dashboard)     - DashboardOutlined
设备管理 (Devices)       - LaptopOutlined
规则管理 (Rules)         - FileTextOutlined
自动化配置 (Automation)  - ThunderboltOutlined
日志监控 (Logs)          - FileSearchOutlined
系统设置 (Settings)      - SettingOutlined
```

## 3. 功能操作图标

### 3.1 通用操作

```typescript
新增       - PlusOutlined
编辑       - EditOutlined
删除       - DeleteOutlined
刷新       - ReloadOutlined
搜索       - SearchOutlined
导出       - ExportOutlined
保存       - SaveOutlined
同步       - SyncOutlined
```

### 3.2 监控与服务

```typescript
启动监控   - PlayCircleOutlined
停止监控   - PauseCircleOutlined
在线状态   - CheckCircleOutlined
离线状态   - CloseCircleOutlined
警告       - WarningOutlined
错误       - ExclamationCircleOutlined
成功       - CheckOutlined
```

### 3.3 网络与设备

```typescript
公网IP     - CloudOutlined
设备       - LaptopOutlined
服务器     - ApiOutlined
网络       - GlobalOutlined
连接       - LinkOutlined
```

### 3.4 数据操作

```typescript
规则列表   - FileTextOutlined
配置       - SettingOutlined
日志       - FileSearchOutlined
备份       - SaveOutlined
交换/同步  - SwapOutlined
时钟       - ClockCircleOutlined
```

## 4. Dashboard页面图标

```typescript
// 状态卡片
公网IP      - CloudOutlined
在线设备    - LaptopOutlined
总规则数    - FileTextOutlined
检测间隔    - ClockCircleOutlined

// 快速操作
启动监控    - PlayCircleOutlined
停止监控    - PauseCircleOutlined
手动更新    - SyncOutlined
查看日志    - FileSearchOutlined
同步规则    - SwapOutlined
备份配置    - SaveOutlined
导出日志    - ExportOutlined
```

## 5. 设备管理页面图标

```typescript
添加设备    - PlusOutlined
测试连接    - ApiOutlined
编辑设备    - EditOutlined
删除设备    - DeleteOutlined
搜索        - SearchOutlined
刷新        - ReloadOutlined
```

## 6. 规则管理页面图标

```typescript
新增规则    - PlusOutlined
编辑规则    - EditOutlined
删除规则    - DeleteOutlined
同步规则    - SyncOutlined
导出规则    - ExportOutlined
刷新        - ReloadOutlined
搜索        - SearchOutlined
```

## 7. 自动化配置页面图标

```typescript
雷电/自动化  - ThunderboltOutlined
邮件通知    - MailOutlined
微信通知    - WechatOutlined
定时        - ClockCircleOutlined
```

## 8. 日志监控页面图标

```typescript
搜索日志    - FileSearchOutlined
筛选        - FilterOutlined
刷新        - ReloadOutlined
导出        - ExportOutlined
清空        - DeleteOutlined
```

## 9. 系统设置页面图标

```typescript
设置        - SettingOutlined
安全        - SafetyOutlined
数据库      - DatabaseOutlined
备份        - SaveOutlined
关于        - InfoCircleOutlined
```

## 10. 状态标识图标

```typescript
成功/正常   - CheckCircleOutlined (绿色)
警告        - WarningOutlined (黄色)
错误/失败   - CloseCircleOutlined (红色)
运行中      - LoadingOutlined (蓝色，旋转)
信息        - InfoCircleOutlined (蓝色)
```

## 11. 表格操作图标

```typescript
上移        - UpOutlined
下移        - DownOutlined
排序        - OrderedListOutlined
展开        - DownOutlined / CaretDownOutlined
收起        - UpOutlined / CaretUpOutlined
更多操作    - MoreOutlined / EllipsisOutlined
```

## 12. 对话框图标

```typescript
成功        - CheckCircleOutlined
警告        - ExclamationCircleOutlined
错误        - CloseCircleOutlined
信息        - InfoCircleOutlined
问题        - QuestionCircleOutlined
```

## 13. 使用规范

### 13.1 导入方式

```typescript
import {
  DashboardOutlined,
  LaptopOutlined,
  FileTextOutlined,
  // ... 其他图标
} from '@ant-design/icons';
```

### 13.2 使用示例

```typescript
// 在按钮中使用
<Button icon={<PlusOutlined />}>新增</Button>

// 在菜单中使用
{
  key: 'dashboard',
  icon: <DashboardOutlined />,
  label: '主控制台',
}

// 独立使用
<CheckCircleOutlined style={{ color: '#52c41a' }} />
```

### 13.3 颜色约定

```typescript
成功绿: #52c41a
警告黄: #faad14
错误红: #f5222d
信息蓝: #1890ff
禁用灰: #d9d9d9
```

### 13.4 尺寸规范

```typescript
小图标: 14px (fontSize)
常规图标: 16px (默认)
大图标: 20px
超大图标: 24px
```

## 14. 项目实际使用的图标清单

### 已使用的图标

```typescript
// 从代码中实际使用的图标
CloudOutlined           // 公网IP
LaptopOutlined          // 设备
FileTextOutlined        // 规则/文档
ClockCircleOutlined     // 时间
PlayCircleOutlined      // 播放/启动
PauseCircleOutlined     // 暂停
SyncOutlined            // 同步
FileSearchOutlined      // 搜索日志
SwapOutlined            // 交换
SaveOutlined            // 保存
ExportOutlined          // 导出
PlusOutlined            // 添加
SearchOutlined          // 搜索
ReloadOutlined          // 刷新
EditOutlined            // 编辑
DeleteOutlined          // 删除
ApiOutlined             // API/测试连接
DashboardOutlined       // 仪表板
ThunderboltOutlined     // 自动化
SettingOutlined         // 设置
```

## 15. 注意事项

1. **不要使用emoji** - 统一使用图标库
2. **保持一致性** - 同一功能使用相同图标
3. **语义化** - 图标要符合功能含义
4. **大小适配** - 根据使用场景选择合适尺寸
5. **颜色规范** - 遵循Ant Design的颜色体系
6. **加载状态** - 使用LoadingOutlined并设置spin属性

## 16. 扩展建议

如需使用自定义图标，建议：

1. 使用SVG格式
2. 确保图标大小为24x24px
3. 使用单色设计
4. 遵循Ant Design的视觉风格
