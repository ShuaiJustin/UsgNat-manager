import React, { useEffect, useState } from 'react';
import { App, Button, Card, DatePicker, Dropdown, Input, Select, Space, Table, Tag } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  ExportOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';

import type { Log } from '@/types';
import { formatLogDetails } from '@/utils/logDetailsFormatter';
import { createTablePagination } from '@/utils/tablePagination';

const { RangePicker } = DatePicker;

type LogLevelFilter = 'all' | Log['level'];

type LogExportFilter = {
  level?: Log['level'];
  startDate?: Date;
  endDate?: Date;
  search?: string;
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const Logs: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const [searchText, setSearchText] = useState('');
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const queryClient = useQueryClient();
  useEffect(() => setPage(1), [searchText, levelFilter, dateRange, pageSize]);
  const filter: LogExportFilter = {
    search: searchText || undefined,
    level: levelFilter === 'all' ? undefined : levelFilter,
    startDate: dateRange[0]?.startOf('day').toDate(),
    endDate: dateRange[1]?.endOf('day').toDate(),
  };

  const { data: pageData, isLoading } = useQuery<{ rows: Log[]; total: number }>({
    queryKey: ['logs', filter, page, pageSize],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.log?.queryPage) {
        throw new Error('log API 未就绪');
      }
      return api.log.queryPage({ ...filter, offset: (page - 1) * pageSize, limit: pageSize });
    },
    enabled: typeof window.electronAPI?.log?.queryPage === 'function',
    retry: 2,
  });

  const getLevelIcon = (level: Log['level']) => {
    switch (level) {
      case 'SUCCESS':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'INFO':
        return <InfoCircleOutlined style={{ color: '#1890ff' }} />;
      case 'WARNING':
        return <WarningOutlined style={{ color: '#faad14' }} />;
      case 'ERROR':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return null;
    }
  };

  const levelLabel: Record<Log['level'], string> = {
    SUCCESS: t('common.success'),
    INFO: t('common.info'),
    WARNING: t('common.warning'),
    ERROR: t('common.error'),
  };

  const getLevelColor = (level: Log['level']) => {
    switch (level) {
      case 'SUCCESS':
        return 'success';
      case 'INFO':
        return 'processing';
      case 'WARNING':
        return 'warning';
      case 'ERROR':
        return 'error';
      default:
        return 'default';
    }
  };

  const columns: ColumnsType<Log> = [
    {
      title: t('logs.time'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: Log['createdAt']) => {
        if (!date) {
          return '-';
        }

        const parsedDate = new Date(date);
        if (Number.isNaN(parsedDate.getTime())) {
          return '-';
        }

        return parsedDate.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      },
    },
    {
      title: t('logs.level'),
      dataIndex: 'level',
      key: 'level',
      width: 100,
      render: (level: Log['level']) => (
        <Tag icon={getLevelIcon(level)} color={getLevelColor(level)}>
          {levelLabel[level] ?? level}
        </Tag>
      ),
    },
    {
      title: t('logs.operation'),
      dataIndex: 'operation',
      key: 'operation',
      width: 150,
    },
    {
      title: t('logs.message'),
      dataIndex: 'message',
      key: 'message',
    },
  ];

  const filteredLogs = pageData?.rows;

  const handleExport = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.log?.export) {
        throw new Error('log API 未就绪');
      }

      const csv = await api.log.export(filter);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `logs_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      message.success('导出成功');
    } catch (error) {
      message.error(`导出失败: ${getErrorMessage(error, '未知错误')}`);
    }
  };

  const confirmCleanup = (days: number) =>
    modal.confirm({
      title: days ? `只保留最近 ${days} 天的日志？` : '清空全部日志？',
      content: '删除后无法恢复。',
      okText: days ? '清理' : '全部清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => handleCleanup(days),
    });

  const handleCleanup = async (days: number) => {
    try {
      const api = window.electronAPI;
      if (!api?.log?.cleanup) {
        throw new Error('log API 未就绪');
      }

      const result = await api.log.cleanup(days);
      await queryClient.invalidateQueries({ queryKey: ['logs'] });
      message.success(`清理成功，删除了 ${result.count} 条日志`);
    } catch (error) {
      message.error(`清理失败: ${getErrorMessage(error, '未知错误')}`);
    }
  };

  return (
    <div>
      <Card>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <Space wrap>
            <Select style={{ width: 120 }} value={levelFilter} onChange={setLevelFilter}>
              <Select.Option value="all">{t('logs.allLevels')}</Select.Option>
              <Select.Option value="SUCCESS">{t('common.success')}</Select.Option>
              <Select.Option value="INFO">{t('common.info')}</Select.Option>
              <Select.Option value="WARNING">{t('common.warning')}</Select.Option>
              <Select.Option value="ERROR">{t('common.error')}</Select.Option>
            </Select>
            <RangePicker
              value={dateRange}
              onChange={(dates) => setDateRange(dates || [null, null])}
              placeholder={['开始日期', '结束日期']}
              style={{ width: 260 }}
            />
            <Input
              placeholder="搜索操作或内容"
              prefix={<SearchOutlined />}
              style={{ width: 220 }}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              allowClear
            />
          </Space>
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['logs'] });
                setDateRange([null, null]);
                setLevelFilter('all');
                setSearchText('');
              }}
            >
              {t('common.refresh')}
            </Button>
            <Button
              icon={<ExportOutlined />}
              title="按当前筛选导出，最多 10000 条"
              onClick={() => void handleExport()}
            >
              {t('common.export')}
            </Button>
            {/* Destructive actions sit behind a menu and a confirmation, away from everyday buttons. */}
            <Dropdown
              menu={{
                items: [
                  { key: '30', label: '只保留最近 30 天' },
                  { key: '0', label: '清空全部日志', danger: true },
                ],
                onClick: ({ key }) => confirmCleanup(Number(key)),
              }}
            >
              <Button icon={<DeleteOutlined />}>清理</Button>
            </Dropdown>
          </Space>
        </div>

        <Table
          columns={columns}
          dataSource={filteredLogs}
          loading={isLoading}
          rowKey="id"
          pagination={{
            ...createTablePagination(pageSize, '条'),
            current: page,
            pageSize,
            total: pageData?.total ?? 0,
            onChange: (nextPage, nextSize) => {
              setPage(nextPage);
              setPageSize(nextSize);
            },
          }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '12px 24px', background: '#fafafa', borderRadius: 4 }}>
                <div style={{ marginBottom: 8 }}>
                  <strong>详细信息:</strong>
                </div>
                {record.details ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      background: '#fff',
                      border: '1px solid #d9d9d9',
                      borderRadius: 4,
                      fontSize: 12,
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    {formatLogDetails(record.details)}
                  </pre>
                ) : (
                  <div style={{ color: '#999' }}>无详细信息</div>
                )}
              </div>
            ),
            rowExpandable: (record) => !!record.details,
          }}
        />
      </Card>
    </div>
  );
};

export default Logs;
