/** Fresh fictional database per browser script; never connects to an existing service. */
import {spawn} from 'node:child_process';
import path from 'node:path';
const scripts=process.argv.slice(2);
const allowed=['learning-browser.mjs','teacher-tools-browser.mjs','teacher-browser-acceptance.mjs','teacher-exam-browser.mjs','storefront-browser.mjs'];
if(!scripts.length || scripts.some(s=>!allowed.includes(s)))throw Error('Choose an allowed local browser test.');
const root=path.resolve('../..');
for(const script of scripts){
 console.log('LOCAL_BROWSER '+script);
 const server=spawn(process.execPath,['tests/run-teacher-local.mjs','tests/teacher-ui-server.ts','--serve'],{cwd:process.cwd(),stdio:['pipe','pipe','pipe']});
 const closed=new Promise(resolve=>server.once('exit',code=>resolve(code)));
 try{
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Local fixture startup timeout')),45000);server.stdout.on('data',b=>{const line=b.toString();if(line.includes('TEACHER_UI_READY')){clearTimeout(timeout);resolve();}});server.stderr.on('data',b=>process.stderr.write(b));server.once('exit',code=>{clearTimeout(timeout);reject(Error('Fixture exited '+code));});});
  const browser=spawn(process.execPath,[path.join(root,'artifacts/lootbot/tests',script)],{cwd:root,stdio:'inherit'});
  const code=await new Promise(resolve=>browser.once('exit',resolve));
  if(code!==0)throw Error('Browser test failed: '+script);
 }finally{server.stdin.write('stop\n');await closed;}
}
