import React, { useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
} from 'antd';
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
import { matchesLogDateRange } from '@/utils/logDateFilter';
import { formatLogDetails } from '@/utils/logDetailsFormatter';
import { createTablePagination } from '@/utils/tablePagination';

const { RangePicker } = DatePicker;

type LogLevelFilter = 'all' | Log['level'];

type LogExportFilter = {
  level?: Log['level'];
  startDate?: Date;
  endDate?: Date;
};

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const Logs: React.FC = () => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [searchText, setSearchText] = useState('');
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>('all');
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([null, null]);
  const queryClient = useQueryClient();

  const { data: logs, isLoading } = useQuery<Log[]>({
    queryKey: ['logs'],
    queryFn: async () => {
      const api = window.electronAPI;
      if (!api?.log?.query) {
        throw new Error('log API 未就绪');
      }
      return api.log.query({});
    },
    enabled: typeof window.electronAPI?.log?.query === 'function',
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
          {level}
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

  const filteredLogs = logs?.filter((log) => {
    const matchesSearch =
      log.message.toLowerCase().includes(searchText.toLowerCase()) ||
      log.operation.toLowerCase().includes(searchText.toLowerCase());
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
    const matchesDate = matchesLogDateRange(log.createdAt, dateRange);

    return matchesSearch && matchesLevel && matchesDate;
  });

  const stats = {
    info: filteredLogs?.filter((log) => log.level === 'INFO').length || 0,
    success: filteredLogs?.filter((log) => log.level === 'SUCCESS').length || 0,
    warning: filteredLogs?.filter((log) => log.level === 'WARNING').length || 0,
    error: filteredLogs?.filter((log) => log.level === 'ERROR').length || 0,
  };

  const handleExport = async () => {
    try {
      const api = window.electronAPI;
      if (!api?.log?.export) {
        throw new Error('log API 未就绪');
      }

      const filter: LogExportFilter = {};
      if (levelFilter !== 'all') {
        filter.level = levelFilter;
      }
      if (dateRange[0] && dateRange[1]) {
        filter.startDate = dateRange[0].startOf('day').toDate();
        filter.endDate = dateRange[1].endOf('day').toDate();
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
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('common.info')}
              value={stats.info}
              prefix={<InfoCircleOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('common.success')}
              value={stats.success}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('common.warning')}
              value={stats.warning}
              prefix={<WarningOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title={t('common.error')}
              value={stats.error}
              prefix={<CloseCircleOutlined />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
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
                style={{ width: 280 }}
              />
              <Input
                placeholder={t('common.search')}
                prefix={<SearchOutlined />}
                style={{ width: 250 }}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                allowClear
              />
            </Space>
          </Space>

          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Space>
              <Popconfirm
                title="清理日志"
                description="选择要保留的日志天数"
                onConfirm={() => void handleCleanup(30)}
                okText="保留30天"
                cancelText="取消"
              >
                <Button icon={<DeleteOutlined />} danger>
                  清理旧日志
                </Button>
              </Popconfirm>
              <Popconfirm
                title="清理全部日志"
                description="确定要清理全部日志吗？此操作不可恢复"
                onConfirm={() => void handleCleanup(0)}
                okText="确定"
                okType="danger"
                cancelText="取消"
              >
                <Button danger>清理全部</Button>
              </Popconfirm>
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
              <Button icon={<ExportOutlined />} onClick={() => void handleExport()}>
                {t('common.export')}
              </Button>
            </Space>
          </Space>
        </Space>

        <Table
          columns={columns}
          dataSource={filteredLogs}
          loading={isLoading}
          rowKey="id"
          pagination={createTablePagination(20, t('common.info'))}
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
