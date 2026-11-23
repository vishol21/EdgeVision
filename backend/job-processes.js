'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const processes = new WeakMap();

function trackProcess(owner, child) {
  processes.set(owner, { child, stopping: null });
}

async function stopProcess(owner) {
  const record = processes.get(owner);
  if (!record || record.child.exitCode !== null || record.child.signalCode) return;
  if (!record.stopping) {
    record.stopping = (async () => {
      const pid = record.child.pid;
      if (!Number.isInteger(pid) || pid <= 0) return;
      if (process.platform === 'win32') {
        // Only the process tree registered to this request is terminated.
        try { await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }); }
        catch (error) {
          if (record.child.exitCode === null && !record.child.signalCode) throw error;
        }
      } else {
        try { process.kill(-pid, 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    })();
  }
  return record.stopping;
}

async function releaseProcess(owner, child) {
  const record = processes.get(owner);
  if (record?.child !== child) return;
  try { await record.stopping; }
  catch { /* The cancel API reports termination errors; normal finalization must still run. */ }
  finally { processes.delete(owner); }
}
module.exports = { trackProcess, stopProcess, releaseProcess };
