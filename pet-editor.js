(() => {
 const modal=document.createElement('dialog'); modal.className='modal pet-editor';
 modal.setAttribute('aria-labelledby','pet-editor-title');
 modal.innerHTML=`<form method="dialog" class="modal-close-form"><button class="icon-close" aria-label="关闭">×</button></form>
 <h2 id="pet-editor-title">制作你的 Q 弹猫猫</h2><p>选择自己的图片，轻轻一按，就会弹起来。图片只在当前浏览器处理和保存。</p>
 <label class="pet-upload">选择图片<input id="pet-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
 <canvas id="pet-preview" width="256" height="256" aria-label="素材预览，可拖动调整位置"></canvas>
 <div class="pet-controls">
 <label>大小<input id="pet-scale" type="range" min="30" max="140" value="80"></label>
 <label>左右<input id="pet-x" type="range" min="-100" max="100" value="0"></label>
 <label>上下<input id="pet-y" type="range" min="-100" max="100" value="0"></label>
 <label>弹性<input id="pet-squish" type="range" min="5" max="40" value="24"></label>
 </div><p class="pet-tip">建议使用透明背景 PNG；普通图片会连同背景一起变形。拖动预览也能调整位置。</p>
 <p id="pet-editor-status" role="status"></p>
 <div class="modal-actions"><button id="pet-play" class="secondary-button" disabled>预览一次</button><button id="pet-download" class="secondary-button" disabled>下载 GIF</button><button id="pet-save" class="primary-button" disabled>设为我的猫猫</button></div>`;
 document.body.append(modal);
 const $=s=>modal.querySelector(s), canvas=$('#pet-preview'), ctx=canvas.getContext('2d');
 const sliders=['scale','x','y','squish'].map(k=>$('#pet-'+k));
 let source=null, frames=[], timer, loadId=0, dragging=null;
 const status=text=>{$('#pet-editor-status').textContent=text;};
 function stop(){clearTimeout(timer); if(frames.length)ctx.putImageData(frames[3].getContext('2d').getImageData(0,0,256,256),0,0);}
 function draw(target,phase){
  const c=target.getContext('2d'); c.clearRect(0,0,256,256); if(!source)return;
  const scale=Number(sliders[0].value)/100, x=Number(sliders[1].value), y=Number(sliders[2].value);
  const amount=Number(sliders[3].value)/100;
  const base=220/Math.max(source.naturalWidth,source.naturalHeight)*scale;
  const sx=1+phase*amount*.5, sy=1-phase*amount;
  const w=source.naturalWidth*base*sx, h=source.naturalHeight*base*sy;
  c.drawImage(source,128+x-w/2,236+y-h,w,h);
 }
 function rebuild(){clearTimeout(timer); frames=[.45,1,-.3,0].map(phase=>{const c=document.createElement('canvas');c.width=c.height=256;draw(c,phase);return c;});stop();}
 function play(){stop();let n=0;const order=[3,0,1,2,3];const next=()=>{ctx.clearRect(0,0,256,256);ctx.drawImage(frames[order[n]],0,0);if(++n<order.length)timer=setTimeout(next,80);};next();}
 sliders.forEach(input=>input.addEventListener('input',()=>{if(source)rebuild();}));
 canvas.addEventListener('pointerdown',e=>{if(!source)return;stop();dragging={x:e.clientX,y:e.clientY,ox:Number(sliders[1].value),oy:Number(sliders[2].value)};canvas.setPointerCapture(e.pointerId);});
 canvas.addEventListener('pointermove',e=>{if(!dragging)return;const ratio=256/canvas.getBoundingClientRect().width;sliders[1].value=Math.max(-100,Math.min(100,dragging.ox+(e.clientX-dragging.x)*ratio));sliders[2].value=Math.max(-100,Math.min(100,dragging.oy+(e.clientY-dragging.y)*ratio));rebuild();});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,()=>dragging=null);
 $('#pet-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;const version=++loadId;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024){status('请选择不超过 8MB 的 PNG、JPG 或 WebP 图片。');return;}
  const url=URL.createObjectURL(file); const image=new Image();status('正在读取图片……');
  try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});if(version!==loadId)return;
   if(image.naturalWidth*image.naturalHeight>24000000)throw Error('图片尺寸过大，请缩小到 2400 万像素以内。');
   source=image;sliders.forEach((input,i)=>input.value=[80,0,0,24][i]);rebuild();
   for(const id of ['play','save','download'])$('#pet-'+id).disabled=false;
   status('可调整构图，预览后保存。保存会替换之前的自定义素材。');
  }catch(error){if(version===loadId)status(error.message||'无法读取这张图片，请换一张。');}finally{URL.revokeObjectURL(url);}
 });
 $('#pet-play').addEventListener('click',()=>{if(frames.length)play();});
 $('#pet-save').addEventListener('click',()=>{
  if(!frames.length)return;
  const pet={id:'custom',name:'我的猫猫',frames:frames.map(c=>c.toDataURL('image/png')),duration:320};
  try{localStorage.setItem('treehole-custom-pet-v1',JSON.stringify(pet));window.TreeholeCompanion.setCustom(pet);modal.close();}
  catch{status('浏览器存储空间不足或不允许保存，请清理空间后重试。');}
 });
 $('#pet-download').addEventListener('click',()=>{
  if(!frames.length)return;
  try{
   // A fixed 6×6×6 palette plus a transparent entry; encoding stays local.
   const palette=[0];for(let r=0;r<6;r++)for(let g=0;g<6;g++)for(let b=0;b<6;b++)palette.push((r*51<<16)|(g*51<<8)|(b*51));while(palette.length<256)palette.push(0);
   const bytes=new Uint8Array(2000000), writer=new GifWriter(bytes,256,256,{palette});
   for(const n of [3,0,1,2,3]){
    const rgba=frames[n].getContext('2d').getImageData(0,0,256,256).data, pixels=new Uint8Array(256*256);
    for(let i=0;i<pixels.length;i++){const p=i*4;pixels[i]=rgba[p+3]<128?0:1+Math.round(rgba[p]/51)*36+Math.round(rgba[p+1]/51)*6+Math.round(rgba[p+2]/51);}
    writer.addFrame(0,0,256,256,pixels,{delay:8,disposal:2,transparent:0});
   }
   const url=URL.createObjectURL(new Blob([bytes.subarray(0,writer.end())],{type:'image/gif'}));const a=document.createElement('a');a.href=url;a.download='my-bouncy-cat.gif';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('GIF 已生成并开始下载。');
  }catch{status('GIF 生成失败，请刷新页面后重试。');}
 });
 modal.addEventListener('close',()=>{stop();dragging=null;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
 window.TreeholePetEditor={open(){modal.showModal();$('#pet-file').focus();}};
})();
