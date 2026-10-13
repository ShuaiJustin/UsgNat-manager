import type { PaginationProps } from 'antd';

const tablePageSizeOptions = ['10', '20', '30', '50', '100'];

const tablePageSizeChanger: Exclude<PaginationProps['showSizeChanger'], boolean> = {
  showSearch: false,
  getPopupContainer: (triggerNode) => triggerNode.ownerDocument.body,
};

// totalLabel is the unit noun, e.g. "条" renders "共 32 条".
export const createTablePagination = (defaultPageSize: number, totalLabel: string) => ({
  defaultPageSize,
  pageSizeOptions: tablePageSizeOptions,
  showSizeChanger: tablePageSizeChanger,
  showTotal: (total: number) => `共 ${total} ${totalLabel}`,
});
