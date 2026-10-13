import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { ConfigurationLifecycle } from './configuration-lifecycle.ts';
import { MandatoryUpdateBusinessGate } from './mandatory-update-business-gate.ts';

const deferred = () => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('configuration applications execute sequentially and a failure does not poison later requests', async () => {
  const gate = new MandatoryUpdateBusinessGate();
  const first = deferred();
  const starts: (string | undefined)[] = [];
  const lifecycle = new ConfigurationLifecycle({
    gate,
    stop: async () => {},
    reportRestoreError: async () => {},
    apply: async (type) => {
      starts.push(type);
      if (type === 'first') {
        await first.promise;
        throw new Error('first failed');
      }
    },
  });
  const a = lifecycle.apply('first');
  const failed = assert.rejects(a, /first failed/);
  const b = lifecycle.apply('second');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, ['first']);
  first.resolve();
  await failed;
  await b;
  assert.deepEqual(starts, ['first', 'second']);
});

test('maintenance remains blocked until runtime restoration finishes', async () => {
  const gate = new MandatoryUpdateBusinessGate();
  const restore = deferred();
  let restoring = false;
  const lifecycle = new ConfigurationLifecycle({
    gate,
    stop: async () => {},
    reportRestoreError: async () => {},
    apply: async (_type, duringMaintenance) => {
      restoring = true;
      assert.equal(duringMaintenance, true);
      await restore.promise;
    },
  });
  const operation = lifecycle.runDataChange(async () => 'written');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(restoring, true);
  assert.equal(gate.isBlocked(), true);
  assert.equal(gate.tryEnter(), null);
  assert.equal(lifecycle.isMaintaining(), true);
  restore.resolve();
  assert.equal(await operation, 'written');
  assert.equal(gate.isBlocked(), false);
});

test('persisted data with failed runtime restoration reports partial failure to its caller', async () => {
  const gate = new MandatoryUpdateBusinessGate();
  const lifecycle = new ConfigurationLifecycle({
    gate,
    stop: async () => {},
    reportRestoreError: async () => {},
    apply: async () => {
      throw new Error('monitor failed');
    },
  });
  await assert.rejects(
    lifecycle.runDataChange(async () => 'written'),
    /数据已写入，但运行服务恢复失败.*monitor failed/
  );
  assert.equal(gate.isBlocked(), false);
});

test('an action failure retains its original cause even if runtime restoration also fails', async () => {
  const gate = new MandatoryUpdateBusinessGate();
  const original = new Error('invalid backup');
  const lifecycle = new ConfigurationLifecycle({
    gate,
    stop: async () => {},
    reportRestoreError: async () => {
      throw new Error('logger failed');
    },
    apply: async () => {
      throw new Error('monitor failed');
    },
  });
  await assert.rejects(
    lifecycle.runDataChange(async () => {
      throw original;
    }),
    (error) => error === original
  );
  assert.equal(gate.isBlocked(), false);
});

test(
  'maintenance permits an already admitted config apply to finish before joining the serial queue',
  { timeout: 2000 },
  async () => {
    const gate = new MandatoryUpdateBusinessGate();
    const releaseSave = gate.tryEnter()!;
    const restoreTypes: (string | undefined)[] = [];
    const lifecycle = new ConfigurationLifecycle({
      gate,
      stop: async () => {},
      reportRestoreError: async () => {},
      apply: async (type) => {
        restoreTypes.push(type);
      },
    });
    const maintenance = lifecycle.runDataChange(async () => {
      await lifecycle.apply('all');
      return 'written';
    });
    await lifecycle.apply('automation');
    releaseSave();
    assert.equal(await maintenance, 'written');
    assert.deepEqual(restoreTypes, ['automation', 'all']);
  }
);

test('failed maintenance restores the previous monitor and does not release the mandatory gate', async () => {
  const gate = new MandatoryUpdateBusinessGate();
  gate.block('mandatory');
  let monitoring = true;
  const lifecycle = new ConfigurationLifecycle({
    gate,
    stop: async () => {
      monitoring = false;
    },
    reportRestoreError: async () => {},
    apply: async () => {
      monitoring = true;
    },
  });
  await assert.rejects(
    lifecycle.runDataChange(async () => {
      throw new Error('transaction rejected');
    }),
    /transaction rejected/
  );
  assert.equal(monitoring, true);
  assert.equal(gate.isBlocked(), true);
  gate.unblock('mandatory');
  assert.equal(gate.isBlocked(), false);
});

test('a rejected import preserves an actual user pause even when stored monitoring is enabled', async () => {
  const gate = new MandatoryUpdateBusinessGate();
  let monitoring = false;
  let beforeMaintenance = false;
  const lifecycle = new ConfigurationLifecycle({
    gate,
    beforeStop: () => {
      beforeMaintenance = monitoring;
    },
    stop: async () => {
      monitoring = false;
    },
    apply: async () => {
      monitoring = true;
    },
    restoreAfterFailure: async () => {
      monitoring = beforeMaintenance;
    },
    reportRestoreError: async () => {},
  });
  await assert.rejects(
    lifecycle.runDataChange(async () => {
      throw new Error('invalid import file');
    }),
    /invalid import file/
  );
  assert.equal(monitoring, false);
  await lifecycle.runDataChange(async () => 'imported');
  assert.equal(monitoring, true);
});
