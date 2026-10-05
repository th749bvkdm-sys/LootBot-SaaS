import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { db,pool,storesTable,usersTable,sessionsTable,telegramBotsTable,auditLogsTable } from '@workspace/db';
import app from '../src/app';
import { sha256,encryptBotToken } from '../src/lib/security';
import { startBotForStore,startActiveStoreBots,stopBotForStore,stopAllBots } from '../src/lib/telegram-bot-manager';
import { withBotConnectionChange } from '../src/lib/bot-connection-lock';

test('saved Telegram reconnect uses isolated HTTP/database and abort-aware mock transport only',async t=>{
  assert.equal(new URL(process.env.DATABASE_URL!).hostname,'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech');
  await pool.query(await readFile('../../lib/db/migrations/0002_telegram_health.sql','utf8'));
  const owner=randomUUID(),other=randomUUID();const ids=Array.from({length:19},()=>randomUUID());
  t.after(async()=>{if(pool.ended)return;stopAllBots({shutdown:true});await db.delete(storesTable).where(inArray(storesTable.id,ids));await db.delete(usersTable).where(inArray(usersTable.id,[owner,other]));await pool.end();});
  const sessions=new Map<string,{cookie:string;csrf:string}>();
  for(const userId of [owner,other]){await db.insert(usersTable).values({id:userId,name:'Reconnect QA',email:`reconnect-${userId}@example.invalid`,passwordHash:'not-login-test'});const token=randomUUID()+randomUUID(),csrf=randomUUID();await db.insert(sessionsTable).values({id:randomUUID(),userId,tokenHash:sha256(token),csrfHash:sha256(csrf),expiresAt:new Date(Date.now()+3600000)});sessions.set(userId,{cookie:`lootbot_session=${token};lootbot_csrf=${csrf}`,csrf});}
  await db.insert(storesTable).values(ids.map((id,index)=>({id,ownerId:owner,name:'Reconnect isolated '+index,slug:'reconnect-'+id,botStatus:'error'})));
  const tokens=ids.map((_,index)=>`${95010000+index}:synthetic-reconnect-transport-only`);
  const seed=async(index:number,status='error')=>{await db.insert(telegramBotsTable).values({storeId:ids[index],encryptedToken:encryptBotToken(tokens[index]),tokenHash:sha256(tokens[index]),telegramBotId:String(95010000+index),firstName:'Mock bot',username:'MockIsolatedBot',status,lastError:'Earlier isolated error',lastUpdateId:'777'});};
  for(const index of [0,1,2,3,4,5,6,7,8,9,10,12,13,14,15,16,18])await seed(index,index===3?'disconnected':'error');
  const nativeFetch=globalThis.fetch;const polls:{index:number;offset:string|null}[]=[];const methods:string[]=[];
  const behavior=new Map<number,{webhook?:string;failure?:number;validate?:()=>Promise<void>;pollFailure?:number;pollReplies?:unknown[][];latePoll?:(resolve:(response:Response)=>void)=>void}>();
  const pendingLatePolls:((response:Response)=>void)[]=[];
  const pendingGates:(()=>void)[]=[];
  const reply=(result:unknown)=>new Response(JSON.stringify({ok:true,result}),{status:200});
  const failure=(code:number)=>new Response(JSON.stringify({ok:false,error_code:code}),{status:code});
  const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
  const waitUntil=async(check:()=>boolean)=>{for(let i=0;i<200&&!check();i++)await delay(25);assert.ok(check(),'Expected mock lifecycle phase was reached');};
  globalThis.fetch=(async(input:any,options:any)=>{
    const url=new URL(String(input));
    if(url.origin==='https://api.telegram.org'){
      const index=tokens.indexOf(url.pathname.split('/')[1].slice(3));assert.ok(index>=0,'Only synthetic fixture Telegram credentials may enter this transport');
      const method=url.pathname.split('/')[2];methods.push(method);const mode=behavior.get(index);
      if(method==='getMe'){if(mode?.failure)return failure(mode.failure);return reply({id:95010000+index,is_bot:true,first_name:'Mock bot',username:'MockIsolatedBot'});}
      if(method==='getWebhookInfo'){await mode?.validate?.();return reply({url:mode?.webhook??''});}
      if(method==='getUpdates'){polls.push({index,offset:url.searchParams.get('offset')});if(mode?.pollFailure)return failure(mode.pollFailure);if(mode?.pollReplies?.length)return reply(mode.pollReplies.shift());if(mode?.latePoll)return new Promise<Response>(resolve=>{pendingLatePolls.push(resolve);mode.latePoll!(resolve);});return new Promise<Response>((_resolve,reject)=>{if(options.signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});}
      throw Error('This acceptance transport never delivers Telegram messages');
    }
    assert.equal(url.hostname,'127.0.0.1');return nativeFetch(input,options);
  }) as typeof fetch;
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  const request=async(index:number,action='telegram/reconnect',user:string|null=owner,csrf=true,method='POST',body?:unknown)=>{const auth=user?sessions.get(user):undefined;const response=await fetch(`${base}/stores/${ids[index]}/${action}`,{method,headers:{...(auth?{cookie:auth.cookie,...(csrf?{'x-csrf-token':auth.csrf}:{})}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};};
  const row=async(index:number)=>(await db.select().from(telegramBotsTable).where(eq(telegramBotsTable.storeId,ids[index])))[0];
  try{
    await t.test('session, CSRF and owner checks reject before any credential use',async()=>{
      const before=methods.length;assert.equal((await request(0,'telegram/reconnect',null)).status,401);assert.equal((await request(0,'telegram/reconnect',owner,false)).status,403);assert.equal((await request(0,'telegram/reconnect',other)).status,404);assert.equal(methods.length,before);
    });
    await t.test('diagnostic testing stays diagnostic; owner reconnect resumes saved offset and audits without exposing credentials',async()=>{
      assert.equal((await request(0,'telegram/test-connection')).status,200);assert.equal((await row(0)).status,'error');assert.equal(polls.length,0);
      behavior.set(0,{pollReplies:[[]]});
      const result=await request(0);assert.equal(result.status,200);assert.equal(result.data.connected,true);assert.deepEqual(Object.keys(result.data).sort(),['connected','firstName','lastError','status','username']);assert.equal((await row(0)).lastUpdateId,'777');assert.equal((await row(0)).status,'connected');assert.ok(polls.some(p=>p.index===0&&p.offset==='777'));
      for(let i=0;i<60&&!(await row(0)).lastSuccessfulPollAt;i++)await delay(25);
      assert.ok((await row(0)).lastSuccessfulPollAt,'A real mocked successful poll must update reception health');
      const audit=await db.select().from(auditLogsTable).where(eq(auditLogsTable.storeId,ids[0]));assert.ok(audit.some(event=>event.action==='telegram.reconnected'));assert.ok(!JSON.stringify(audit).includes(tokens[0]));stopBotForStore(ids[0]);
    });
    await t.test('missing, disconnected, unreadable and invalid saved credentials cannot start reception',async()=>{
      const before=polls.length;assert.equal((await request(11)).status,409);assert.equal((await request(3)).status,409);
      await db.update(telegramBotsTable).set({encryptedToken:'invalid'}).where(eq(telegramBotsTable.storeId,ids[4]));assert.equal((await request(4)).status,409);
      behavior.set(5,{failure:401});assert.equal((await request(5)).status,502);assert.equal((await row(5)).status,'error');assert.equal(polls.length,before);
    });
    await t.test('webhook and active duplicate-token conflicts remain explicit and preserve saved state',async()=>{
      behavior.set(1,{webhook:'https://example.invalid/active-webhook'});assert.equal((await request(1)).status,409);assert.equal((await row(1)).status,'error');
      startBotForStore({storeId:ids[11],token:tokens[2]});assert.equal((await request(2)).status,409);assert.equal((await row(2)).status,'error');stopBotForStore(ids[11]);
    });
    await t.test('credentials changed or store archived during validation cannot resume stale snapshot',async()=>{
      behavior.set(6,{validate:async()=>{await db.update(telegramBotsTable).set({encryptedToken:encryptBotToken(tokens[6])}).where(eq(telegramBotsTable.storeId,ids[6]));}});assert.equal((await request(6)).status,409);assert.equal((await row(6)).status,'error');
      behavior.set(7,{validate:async()=>{await db.update(storesTable).set({isDeleted:true}).where(eq(storesTable.id,ids[7]));}});assert.equal((await request(7)).status,409);assert.ok(!polls.some(p=>p.index===7));
    });
    await t.test('retry rate is bounded and later disconnect removes worker and credential',async()=>{
      for(let i=0;i<3;i++)assert.equal((await request(8)).status,200);assert.equal((await request(8)).status,429);
      assert.equal((await request(8,'bot',owner,true,'DELETE')).status,200);assert.equal(await row(8),undefined);const [store]=await db.select().from(storesTable).where(eq(storesTable.id,ids[8]));assert.equal(store.botStatus,'disconnected');
    });
    await t.test('actual polling conflict records actionable status while transport never sends',async()=>{
      behavior.set(9,{pollFailure:409});assert.equal((await request(9)).status,200);
      for(let i=0;i<60&&(await row(9)).status!=='error';i++)await new Promise(resolve=>setTimeout(resolve,25));
      assert.equal((await row(9)).status,'error');assert.match((await row(9)).lastError!,/استقبال آخر|Webhook/);stopBotForStore(ids[9]);
      assert.ok(methods.every(method=>['getMe','getWebhookInfo','getUpdates'].includes(method)));
    });
    await t.test('delayed error and successful update from replaced same-token workers cannot overwrite the current worker',async()=>{
      const delayed:((response:Response)=>void)[]=[];
      behavior.set(10,{latePoll:resolve=>{delayed.push(resolve);}});
      assert.equal((await request(10)).status,200);await waitUntil(()=>delayed.length===1);
      assert.equal((await request(10)).status,200);await waitUntil(()=>delayed.length===2);
      delayed[0](failure(409));await delay(50);await withBotConnectionChange(ids[10],async()=>{});
      assert.equal((await row(10)).status,'connected');assert.equal((await row(10)).lastUpdateId,'777');
      assert.equal((await request(10)).status,200);await waitUntil(()=>delayed.length===3);
      delayed[1](reply([{update_id:90000,message:{text:'/start',chat:{id:90000,type:'private'},from:{id:90000,first_name:'Never deliver'}}}]));
      await delay(50);await withBotConnectionChange(ids[10],async()=>{});
      assert.equal((await row(10)).status,'connected');assert.equal((await row(10)).lastUpdateId,'777');
      stopBotForStore(ids[10]);delayed[2](reply([]));await delay(25);
      assert.ok(methods.every(method=>['getMe','getWebhookInfo','getUpdates'].includes(method)));
    });
    await t.test('queued disconnect and archive complete before reconnect and cannot recreate reception',async()=>{
      for(const [index,action] of [[12,'bot'],[13,'']] as const){
        let release!:()=>void;let held=false;
        const holding=withBotConnectionChange(ids[index],async()=>{held=true;await new Promise<void>(resolve=>{release=resolve;pendingGates.push(resolve);});});
        await waitUntil(()=>held);
        const deleting=request(index,action,owner,true,'DELETE');await delay(2000);
        const reconnecting=request(index);await delay(2000);release();await holding;
        assert.equal((await deleting).status,200);assert.ok([404,409].includes((await reconnecting).status));
        assert.ok(!polls.some(p=>p.index===index));
        if(index===12)assert.equal(await row(index),undefined);
        else{const [store]=await db.select().from(storesTable).where(eq(storesTable.id,ids[index]));assert.equal(store.isDeleted,true);}
      }
    });
    await t.test('startup validation completed after a stop cannot launch a worker or persist a late failure',async()=>{
      stopAllBots();await db.update(telegramBotsTable).set({status:'error'}).where(inArray(telegramBotsTable.storeId,ids));
      for(const [index,rejectValidation] of [[14,false],[15,true]] as const){
        await db.update(telegramBotsTable).set({status:'connected',lastError:null}).where(eq(telegramBotsTable.storeId,ids[index]));
        let release!:()=>void;let entered=false;
        behavior.set(index,{validate:async()=>{entered=true;await new Promise<void>(resolve=>{release=resolve;pendingGates.push(resolve);});if(rejectValidation)throw Error('Synthetic late validation failure');}});
        const starting=startActiveStoreBots([ids[index]]);await waitUntil(()=>entered);stopAllBots();release();await starting;
        assert.equal((await row(index)).status,'connected');assert.equal((await row(index)).lastError,null);assert.ok(!polls.some(p=>p.index===index));
        await db.update(telegramBotsTable).set({status:'error'}).where(eq(telegramBotsTable.storeId,ids[index]));
      }
    });
    await t.test('a reconnect queued before a lifecycle stop returns conflict instead of restarting afterward',async()=>{
      let release!:()=>void;let held=false;
      const holding=withBotConnectionChange(ids[16],async()=>{held=true;await new Promise<void>(resolve=>{release=resolve;pendingGates.push(resolve);});});await waitUntil(()=>held);
      const resuming=request(16);await delay(2000);stopAllBots();release();await holding;
      assert.equal((await resuming).status,409);assert.equal((await row(16)).status,'error');assert.ok(!polls.some(p=>p.index===16));
    });
    await t.test('shutdown drains in-flight new connections and future resume requests without changing valid saved connections',async()=>{
      let release!:()=>void;let entered=false;
      behavior.set(17,{validate:async()=>{entered=true;await new Promise<void>(resolve=>{release=resolve;pendingGates.push(resolve);});}});
      const connecting=request(17,'bot',owner,true,'POST',{token:tokens[17]});await waitUntil(()=>entered);
      stopAllBots({shutdown:true});release();assert.equal((await connecting).status,409);assert.equal(await row(17),undefined);
      await db.update(telegramBotsTable).set({status:'connected',lastError:null}).where(eq(telegramBotsTable.storeId,ids[18]));
      assert.equal((await request(18)).status,409);assert.equal((await row(18)).status,'connected');assert.equal((await row(18)).lastError,null);
      assert.ok(!polls.some(p=>p.index===17||p.index===18));assert.throws(()=>startBotForStore({storeId:ids[18],token:tokens[18]}));
    });
  }finally{
    stopAllBots({shutdown:true});for(const release of pendingGates)release();for(const resolve of pendingLatePolls)resolve(reply([]));await Promise.all(ids.map(id=>withBotConnectionChange(id,async()=>{})));
    await new Promise<void>(resolve=>server.close(()=>resolve()));globalThis.fetch=nativeFetch;await db.delete(storesTable).where(inArray(storesTable.id,ids));await db.delete(usersTable).where(inArray(usersTable.id,[owner,other]));await pool.end();
  }
});
