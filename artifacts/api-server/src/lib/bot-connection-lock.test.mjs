import assert from 'node:assert/strict';
import test from 'node:test';
import { withBotConnectionChange } from './bot-connection-lock.ts';

test('bot lifecycle changes serialize per store and release even after a failure',async()=>{
  const events=[];let release;
  const wait=new Promise(resolve=>{release=resolve;});
  const first=withBotConnectionChange('a',async()=>{events.push('first');await wait;events.push('first-end');});
  const second=withBotConnectionChange('a',async()=>{events.push('second');throw Error('expected');}).catch(()=>{});
  await withBotConnectionChange('b',async()=>events.push('other-store'));
  assert.deepEqual(events,['first','other-store']);release();await Promise.all([first,second]);
  await withBotConnectionChange('a',async()=>events.push('third'));
  assert.deepEqual(events,['first','other-store','first-end','second','third']);
});
