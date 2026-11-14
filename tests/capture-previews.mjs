/** Capture local QA artifacts from an isolated Chrome; see browser-regression.mjs. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const debug = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9224';
const site = process.env.SITE_URL || 'http://127.0.0.1:8765/';
const baseline = process.argv.includes('--baseline');
const out = resolve('docs/previews', baseline ? 'before' : '.');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, target, serial = 0;
const pending = new Map();
const errors = [];
const resourceFailures = [];
async function call(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error(method + ' timed out')); }, 15000);
    pending.set(id, {resolve, reject, timer});
    socket.send(JSON.stringify({id, method, params}));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
  if(result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression) {
  for(let i=0;i<150;i++) { if(await evaluate(expression))return; await delay(100); }
  throw Error('Timed out: ' + expression);
}
async function navigate(width,height,lang='zh',hash='') {
  await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`${site}?lang=${lang}${hash}`});
  await waitFor("!!window.studyRoom && document.querySelector('#scene').dataset.ready === 'true'");
  await delay(700);
}
async function shot(name, full=false) {
  const options = {format:'png',captureBeyondViewport:full};
  if(full) {
    const {cssContentSize:s} = await call('Page.getLayoutMetrics');
    options.clip={x:0,y:0,width:s.width,height:s.height,scale:1};
  }
  const {data}=await call('Page.captureScreenshot',options);
  await writeFile(resolve(out,name),Buffer.from(data,'base64'));
}
async function metrics() {
  return evaluate(`(async()=>{
    const frames=[]; let last=performance.now();
    for(let i=0;i<31;i++) { await new Promise(requestAnimationFrame); const now=performance.now(); if(i)frames.push(now-last); last=now; }
    const n=performance.getEntriesByType('navigation')[0];
    return {viewport:[innerWidth,innerHeight],domContentLoadedMs:Math.round(n.domContentLoadedEventEnd),loadMs:Math.round(n.loadEventEnd),frameIntervalMedianMs:frames.sort((a,b)=>a-b)[15],resources:performance.getEntriesByType('resource').length};
  })()`);
}
try {
  await mkdir(out,{recursive:true});
  target=await(await fetch(`${debug}/json/new?about:blank`,{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',event=>{
    const m=JSON.parse(event.data);
    if(m.id){ const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result); }
    else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);
    else if(m.method==='Network.responseReceived' && m.params.response.status >= 400)
      resourceFailures.push({url:m.params.response.url,status:m.params.response.status});
  });
  await call('Runtime.enable'); await call('Page.enable');
  await call('Network.enable'); await call('Network.setCacheDisabled',{cacheDisabled:true});
  await navigate(1440,900);
  const measurements={desktop:await metrics()};
  await shot('desktop.png');
  if(!baseline) {
    const poster=await evaluate("window.studyRoom.capture({neutral:true,type:'image/webp',quality:.92})");
    await writeFile(resolve('assets/room-landscape.webp'),Buffer.from(poster.split(',')[1],'base64'));
    measurements.landscape=await evaluate(`({width:document.querySelector('#scene').clientWidth,height:document.querySelector('#scene').clientHeight,points:[...document.querySelectorAll('.hotspot')].map(n=>[parseFloat(n.style.left),parseFloat(n.style.top)])})`);
  }
  await navigate(1440,900,'zh','#project/anchorcell');
  await shot('reader.png');
  await navigate(1440,900,'en','#project/crypto');
  await shot('reader-en.png');
  await navigate(390,844);
  measurements.mobile=await metrics();
  await shot('mobile.png',true);
  if(!baseline) {
    const poster=await evaluate("window.studyRoom.capture({neutral:true,type:'image/webp',quality:.92})");
    await writeFile(resolve('assets/room-portrait.webp'),Buffer.from(poster.split(',')[1],'base64'));
    measurements.portrait=await evaluate(`({width:document.querySelector('#scene').clientWidth,height:document.querySelector('#scene').clientHeight,points:[...document.querySelectorAll('.hotspot')].map(n=>[parseFloat(n.style.left),parseFloat(n.style.top)])})`);
    await navigate(1200,630);
    const og=await call('Page.captureScreenshot',{format:'png'});
    await writeFile(resolve('og.png'),Buffer.from(og.data,'base64'));
  }
  if(!baseline) {
    const anchors={landscape:measurements.landscape,portrait:measurements.portrait};
    await writeFile(resolve('assets/poster-anchors.js'),'// Generated by tests/capture-previews.mjs from the neutral scene posters.\nexport const posterAnchors = '+JSON.stringify(anchors,null,2)+';\n');
  }
  measurements.exceptions=errors;
  measurements.resourceFailures=resourceFailures;
  await writeFile(resolve(out,'measurements.json'),JSON.stringify(measurements,null,2)+'\n');
  console.log(JSON.stringify({out,...measurements},null,2));
  if(errors.length || resourceFailures.length)process.exitCode=1;
} finally {
  if(socket?.readyState===WebSocket.OPEN)socket.close();
  if(target?.id)await fetch(`${debug}/json/close/${target.id}`);
}
