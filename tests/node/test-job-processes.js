'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { trackProcess, stopProcess, releaseProcess } = require('../../backend/job-processes');

test('cancellation terminates the owned process tree and leaves unrelated work alone', async () => {
  const options = { detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], options);
  const child = spawn(process.execPath, ['-e', "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000)"], options);
  const owner = {}; trackProcess(owner, child);
  try {
    const [chunk] = await once(child.stdout, 'data');
    const descendant = Number(String(chunk).trim()); assert.ok(descendant > 0);
    const closed = once(child, 'close');
    await Promise.all([stopProcess(owner), stopProcess(owner)]);
    await closed; await releaseProcess(owner, child);
    assert.throws(() => process.kill(descendant, 0));
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    await stopProcess(owner);
  } finally { child.kill(); unrelated.kill(); }
});

test('cancelling a completed owner does not signal a stale PID', async () => {
  const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
  const owner = {}; trackProcess(owner, child); await once(child, 'close');
  await releaseProcess(owner, child); await stopProcess(owner);
});
