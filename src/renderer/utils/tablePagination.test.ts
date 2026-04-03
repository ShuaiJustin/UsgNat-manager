import assert from 'node:assert/strict';
import test from 'node:test';

import { createTablePagination } from './tablePagination.ts';

test('disables page-size search for compact table pagination selects', () => {
  const pagination = createTablePagination(10, '信息');

  assert.equal(pagination.pageSize, 10);
  assert.equal(typeof pagination.showSizeChanger, 'object');
  assert.equal(pagination.showSizeChanger?.showSearch, false);
});

test('formats total text with the provided label', () => {
  const pagination = createTablePagination(20, '信息');

  assert.equal(pagination.showTotal?.(32), '信息: 32');
});

test('renders the page-size dropdown in the document body to avoid table clipping', () => {
  const pagination = createTablePagination(10, '信息');
  const fakeBody = { nodeName: 'BODY' } as HTMLElement;
  const fakeTrigger = {
    ownerDocument: {
      body: fakeBody,
    },
  } as HTMLElement;

  assert.equal(pagination.showSizeChanger?.getPopupContainer?.(fakeTrigger), fakeBody);
});
