import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function run(args,cwd=root){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd,stdio:'inherit'});process.once('SIGINT',()=>child.kill('SIGINT'));child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Preview process exited: '+code)));});}
await run(['scripts/run-pnpm.mjs','--filter','@workspace/lootbot','run','build']);
await run(['tests/run-teacher-local.mjs','tests/education-ui-server.ts','--serve'],path.join(root,'artifacts/api-server'));
