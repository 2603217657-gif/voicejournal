const {test}=require('node:test');
const assert=require('node:assert/strict');
const request=(messages=[{role:'user',content:'今天有点累'}],mode='warm')=>new Request('https://journal.pages.dev/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,mode})});
const env={AI_API_KEY:'test-only',AI_CHAT_MODEL:'test-model'};
test('Pages backend forwards mode and returns provider text without leaking credentials',async()=>{
 const {handleChat}=await import('../scripts/pages-chat.mjs');
 const response=await handleChat(request(undefined,'no-advice'),env,async(url,options)=>{
 assert.equal(url,'https://api.deepseek.com/chat/completions');
 assert.equal(options.headers.Authorization,'Bearer test-only');
 assert.match(JSON.parse(options.body).messages[0].content,/不提出建议/);
 return Response.json({choices:[{message:{content:'我在这里听你说。'}}]});
 });
 assert.equal(response.status,200); const body=await response.json(); assert.equal(body.text,'我在这里听你说。'); assert.equal(body.demo,false); assert.equal(JSON.stringify(body).includes('test-only'),false);
});
test('Pages validates input, missing configuration, and prioritizes crisis before upstream',async()=>{
 const {handleChat}=await import('../scripts/pages-chat.mjs');
 const noCall=()=>{throw Error('provider must not be called');};
 assert.equal((await handleChat(request([]),env,noCall)).status,400);
 assert.equal((await handleChat(request(),{},noCall)).status,503);
 assert.equal((await (await handleChat(request([{role:'user',content:'不想活了'}]),{},noCall)).json()).crisis,true);
});
test('Pages hides upstream error bodies and handles empty replies',async()=>{
 const {handleChat}=await import('../scripts/pages-chat.mjs');
 const response=await handleChat(request(),env,async()=>new Response('private provider details',{status:401}));
 assert.equal(response.status,502); assert.doesNotMatch(await response.text(),/private provider/);
 assert.equal((await handleChat(request(),env,async()=>Response.json({choices:[]}))).status,502);
});
