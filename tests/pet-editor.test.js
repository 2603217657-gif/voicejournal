const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const {GifWriter,GifReader}=require('../vendor/omggif.js');
test('custom editor creates four hand-free frames, saves them and exports a valid five-frame GIF',async()=>{
 const nodes=new Map();let saved, selected, download;const drawings=[];
 const ctx={clearRect(){},drawImage(...args){drawings.push(args);},putImageData(){},getImageData(){const data=new Uint8ClampedArray(256*256*4);data.fill(255);return {data};}};
 const node=()=>({value:0,handlers:{},setAttribute(){},focus(){},append(){},remove(){},click(){},addEventListener(k,f){this.handlers[k]=f;},getContext(){return ctx;},toDataURL(){return 'data:image/png;base64,AAAA';}});
 const dialog=node();dialog.querySelector=s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);};dialog.close=()=>{};
 const store={setItem(k,v){saved=JSON.parse(v);}};
 const context=vm.createContext({document:{createElement:type=>type==='dialog'?dialog:node(),body:{append(){}},addEventListener(){}},window:{TreeholeCompanion:{setCustom(p){selected=p;}}},localStorage:store,Image:class{naturalWidth=300;naturalHeight=200;set src(v){this.onload();}},URL:{createObjectURL(v){if(v instanceof Blob)download=v;return 'blob:test';},revokeObjectURL(){}},Blob,GifWriter,Uint8Array,clearTimeout(){},setTimeout(){}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../pet-editor.js'),'utf8'),context);
 await nodes.get('#pet-file').handlers.change({target:{files:[{type:'image/png',size:100}]}});
 assert.equal(nodes.get('#pet-save').disabled,false);
 const initial=drawings.slice(0,4);assert.equal(initial.length,4);assert.ok(initial[1][4]<initial[3][4]);
 nodes.get('#pet-save').handlers.click();assert.equal(saved.frames.length,4);assert.equal(selected.id,'custom');
 nodes.get('#pet-download').handlers.click();assert.ok(download);const reader=new GifReader(new Uint8Array(await download.arrayBuffer()));assert.equal(reader.numFrames(),5);assert.equal(reader.width,256);
 const pixels=new Uint8Array(256*256*4);reader.decodeAndBlitFrameRGBA(0,pixels);assert.equal(pixels[3],255);
});
