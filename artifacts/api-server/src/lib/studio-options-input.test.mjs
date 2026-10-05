import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStudioOptionsQuery } from './studio-options-input.ts';

test('studio selectors bound search, pagination and saved labels before querying owned records', () => {
  assert.deepEqual(parseStudioOptionsQuery({}), { q: '', selected: '', page: 1 });
  assert.deepEqual(parseStudioOptionsQuery({ q: ' Actual ', page: '100000', selected: 'c2d074eb-dbff-44d4-98b0-dfbefa2e547a' }), { q: 'Actual', selected: 'c2d074eb-dbff-44d4-98b0-dfbefa2e547a', page: 100000 });
  for (const value of [null, [], { q: [] }, { q: 'x'.repeat(101) }, { selected: {} }, { selected: 'foreign' }, { page: ['1'] }, { page: 2 }, { page: '0' }, { page: '1.5' }, { page: '100001' }]) assert.equal(parseStudioOptionsQuery(value), null);
});
