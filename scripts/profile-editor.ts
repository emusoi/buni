// bun scripts/profile-editor.ts path/to/large.buni [metrics.jsonl]
// A disposable design copy; Chrome gestures are recorded without editing the original.
import { createEditor, type Editor } from "../src/editor/server.ts";
import { cp, mkdtemp, rm, appendFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DiskStore } from "../src/editor/store.ts";
import { buildAssets, compress } from "../src/editor/assets.ts";
const given = process.argv[2];
if (!given) throw new Error("usage: bun scripts/profile-editor.ts design.buni [metrics.jsonl]");
const source = resolve(given);
console.error("Copying design");
const dir = await mkdtemp(join(tmpdir(), "buni-profile-"));
const folder = basename(dirname(source));
await cp(dirname(source), join(dir, folder), { recursive: true, filter: path => !path.endsWith(".live") });
const output = process.argv[3] ? resolve(process.argv[3]) : undefined;
const instrument = `
const profile={started:performance.now(),long:[],frames:[],inputs:[],work:[]};
for(const [proto,key] of [[DOMParser.prototype,'parseFromString'],[XMLSerializer.prototype,'serializeToString'],[CanvasRenderingContext2D.prototype,'drawImage']]){const original=proto[key];proto[key]=function(...args){const at=performance.now();try{return original.apply(this,args)}finally{const ms=performance.now()-at;if(ms>2)profile.work.push({name:key,at,ms})}}}
new PerformanceObserver(list=>{for(const e of list.getEntries())profile.long.push({at:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
let previous=performance.now();
function tick(now){profile.frames.push({at:now,ms:now-previous});previous=now;requestAnimationFrame(tick)}requestAnimationFrame(tick);
for(const type of ['wheel','pointermove','pointerup','keydown'])document.addEventListener(type,e=>{const at=performance.now();requestAnimationFrame(()=>profile.inputs.push({type,at,ms:performance.now()-at,queued:at-e.timeStamp}));},{capture:true,passive:true});
const percentile=(values,p)=>values.length?values.sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]:0;
setInterval(()=>{let out=document.getElementById('buni-profile');if(!out){out=document.createElement('output');out.id='buni-profile';out.hidden=true;document.body.append(out)}const since=performance.now()-6000;const frames=profile.frames.filter(x=>x.at>since).map(x=>x.ms);const input=profile.inputs.filter(x=>x.at>since);out.textContent=JSON.stringify({ageMs:performance.now()-profile.started,visibility:document.visibilityState,framesSampled:frames.length,frameMs:{p50:percentile(frames,.5),p95:percentile(frames,.95),max:Math.max(0,...frames)},longTasks:profile.long.filter(x=>x.at>since),work:profile.work.filter(x=>x.at>since),input,iframes:document.querySelectorAll('iframe').length,previews:document.querySelectorAll('.board-preview').length,previewPixels:[...document.querySelectorAll('.board-preview')].reduce((n,i)=>n+i.width*i.height,0),srcdocChars:[...document.querySelectorAll('iframe')].reduce((n,f)=>n+f.srcdoc.length,0),heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:undefined});fetch('/__profile',{method:'POST',body:out.textContent}).catch(()=>{});profile.frames=profile.frames.filter(x=>x.at>since);profile.inputs=profile.inputs.filter(x=>x.at>since);profile.long=profile.long.filter(x=>x.at>since);profile.work=profile.work.filter(x=>x.at>since)},500);
`;
const start=performance.now();
console.error("Building editor");
const assets=await buildAssets();
console.error("Starting editor");
const client=assets.files.get(assets.client)!;
assets.files.set(assets.client,compress(new TextEncoder().encode(instrument+new TextDecoder().decode(client.body)),client.type));
const ready=Promise.withResolvers<Editor>();
const server=Bun.serve({port:0,hostname:'127.0.0.1',idleTimeout:0,fetch: async req => {
  if (new URL(req.url).pathname === '/__profile' && req.method === 'POST') {
    const line = await req.text();
    if (output) await appendFile(output, `${line}\n`);
    return new Response('recorded');
  }
  return (await ready.promise).fetch(req);
}});
const file=join(dir, folder, basename(source));
const editor=await createEditor({store:new DiskStore(dir),origin:`http://localhost:${server.port}`,localFile:file,assets:()=>assets});
ready.resolve(editor);
console.log(JSON.stringify({url:`http://localhost:${server.port}/?file=${encodeURIComponent(`/designs/${folder}/${basename(source)}`)}`,startupMs:performance.now()-start,copy:file}));
const stop=async()=>{editor.stop();server.stop(true);await rm(dir,{recursive:true,force:true});process.exit(0)};
process.on('SIGINT',stop);process.on('SIGTERM',stop);setTimeout(stop,600000);
