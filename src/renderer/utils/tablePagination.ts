import type { PaginationProps } from 'antd';

const tablePageSizeOptions = ['10', '20', '30', '50', '100'];

const tablePageSizeChanger: Exclude<PaginationProps['showSizeChanger'], boolean> = {
  showSearch: false,
  getPopupContainer: (triggerNode) => triggerNode.ownerDocument.body,
};

export const createTablePagination = (defaultPageSize: number, totalLabel: string) => ({
  defaultPageSize,
  pageSizeOptions: tablePageSizeOptions,
  showSizeChanger: tablePageSizeChanger,
  showTotal: (total: number) => `${totalLabel}: ${total}`,
});
