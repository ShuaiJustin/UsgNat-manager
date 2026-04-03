import type { PaginationProps } from 'antd';

const tablePageSizeChanger: Exclude<PaginationProps['showSizeChanger'], boolean> = {
  showSearch: false,
  getPopupContainer: (triggerNode) => triggerNode.ownerDocument.body,
};

export const createTablePagination = (pageSize: number, totalLabel: string) => ({
  pageSize,
  showSizeChanger: tablePageSizeChanger,
  showTotal: (total: number) => `${totalLabel}: ${total}`,
});
