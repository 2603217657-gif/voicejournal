const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../chat.js'), 'utf8');
test('sealed sessions cannot become active after reload or through stale history entries', () => {
  const sealed = {id:'sealed', sealedAt:'2026-11-10', messages:[{text:'private'}]};
  const open = {id:'open', messages:[]};
  const context = vm.createContext({readSessions:()=>[sealed, open], activeSessionId:'sealed', localStorage:{setItem(){throw Error('sealed history must not activate');}}});
  vm.runInContext(source.slice(source.indexOf('function getActiveSession()'),source.indexOf('function renderActiveSession()')),context);
  vm.runInContext(source.slice(source.indexOf('function openSession('),source.indexOf('function renderHistory()')),context);
  assert.equal(context.getActiveSession(),null);
  context.openSession({id:'sealed'});
  context.openSession({id:'missing'});
  context.activeSessionId='open';
  assert.equal(context.getActiveSession(),open);
});
