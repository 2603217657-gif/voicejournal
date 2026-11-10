const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('companion rests on frame 4 and completes each click in order, then switches safely', async () => {
 const nodes = new Map(); const displayed=[]; let clock=0; let id=0; const timers=new Map();
 const node=()=>({hidden:false,disabled:false,handlers:{},setAttribute(){},focus(){},addEventListener(k,f){this.handlers[k]=f;}});
 for(const selector of ['.yarn-toggle','.cat-panel','.cat-touch','.cat-frame','.cat-switch','.cat-close','.cat-customize']) nodes.set(selector,node());
 Object.defineProperty(nodes.get('.cat-frame'),'src',{set(value){displayed.push(value);}});
 nodes.get('.cat-panel').hidden=true;
 const root=node(); root.querySelector=s=>nodes.get(s);
 const doc={body:{append(){}},createElement:()=>root,addEventListener(){}};
 const context=vm.createContext({document:doc,window:{TREEHOLE_PETS:[{id:'cat',name:'猫',frames:['1','2','3','4'],duration:240},{id:'cat2',name:'第二套',frames:['b1','b2','b3','b4'],duration:240}],addEventListener(){}},Image:class {set src(v){this.onload();}},performance:{now:()=>clock},setTimeout(fn,delay){timers.set(++id,{fn,delay});return id;},clearTimeout(n){timers.delete(n);}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../cat.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(displayed.at(-1),'4'); assert.equal(timers.size,0);
 nodes.get('.yarn-toggle').handlers.click(); displayed.length=0;
 nodes.get('.cat-touch').handlers.click();
 for(let n=0;n<4;n++){const [key,timer]=timers.entries().next().value;timers.delete(key);timer.fn();}
 assert.deepEqual(displayed,['4','1','2','3','4']); assert.equal(timers.size,0);
 clock=120; nodes.get('.cat-touch').handlers.click(); assert.equal([...timers.values()][0].delay,30);
 nodes.get('.cat-close').handlers.click(); assert.equal(displayed.at(-1),'4'); assert.equal(timers.size,0);
 nodes.get('.cat-switch').handlers.click(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(displayed.at(-1),'b4');
 nodes.get('.cat-switch').handlers.click(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(displayed.at(-1),'4');
});
