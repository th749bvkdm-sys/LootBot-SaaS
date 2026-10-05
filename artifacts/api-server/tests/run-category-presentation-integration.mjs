import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const artifact=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(artifact,'../..');
const connection=(await readFile(path.join(root,'.env.v2-test'),'utf8')).trim().slice('DATABASE_URL='.length);
if(new URL(connection).hostname!=='ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech')throw new Error('Only the disposable V2 acceptance branch is allowed.');
const output=path.join(artifact,'.category-presentation-integration.mjs');
await build({entryPoints:[path.join(artifact,'tests/category-presentation-integration.ts')],outfile:output,bundle:true,platform:'node',format:'esm',external:['pg-native','pino','pino-pretty'],banner:{js:"import { createRequire } from 'node:module';globalThis.require=createRequire(import.meta.url);"},logLevel:'silent'});
const testUrl=new URL(connection);testUrl.searchParams.set('sslmode','verify-full');
try{const child=spawn(process.execPath,['--test',output],{cwd:artifact,stdio:'inherit',env:{...process.env,DATABASE_URL:testUrl.toString(),NODE_ENV:'test',LOG_LEVEL:'silent'}});process.exitCode=await new Promise(resolve=>child.once('exit',code=>resolve(code??1)));}finally{await rm(output,{force:true});}
