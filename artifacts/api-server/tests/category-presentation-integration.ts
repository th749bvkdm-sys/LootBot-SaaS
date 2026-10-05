import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import app from '../src/app';
import { db, pool, usersTable, sessionsTable, storesTable, storeSettingsTable, categoriesTable } from '@workspace/db';
import { storeMembersTable } from '../../../lib/db/src/schema/staff';
import { sha256 } from '../src/lib/security';

test('category presentation roundtrip is persisted and scoped by store, role and plan',async t=>{
  assert.equal(new URL(process.env.DATABASE_URL!).hostname,'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech');
  await pool.query(await readFile('../../lib/db/migrations/0007_category_presentation.sql','utf8'));
  const owner=randomUUID(),other=randomUUID(),staff=randomUUID();const storeIds=[randomUUID(),randomUUID(),randomUUID()];const [business,free,pro]=storeIds;
  const categoryIds=[randomUUID(),randomUUID(),randomUUID()];const userIds=[owner,other,staff];const auth=new Map<string,{cookie:string;csrf:string}>();let server:ReturnType<typeof app.listen>|undefined;
  try{
    for(const id of userIds){const token=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();await db.insert(usersTable).values({id,name:'Category presentation QA',email:`category-${id}@example.invalid`,passwordHash:'No login allowed'});await db.insert(sessionsTable).values({id:randomUUID(),userId:id,tokenHash:sha256(token),csrfHash:sha256(csrf),expiresAt:new Date(Date.now()+3600000)});auth.set(id,{cookie:`lootbot_session=${token}; lootbot_csrf=${csrf}`,csrf});}
    await db.insert(storesTable).values(storeIds.map((id,index)=>({id,ownerId:owner,name:'Category QA '+index,slug:'catqa-'+id,currency:'USD'})));
    await db.insert(storeSettingsTable).values(storeIds.map((storeId,index)=>({storeId,settings:{plan:{code:['BUSINESS','FREE','PRO'][index]}}})));
    await db.insert(categoriesTable).values(categoryIds.map((id,index)=>({id,storeId:storeIds[index],name:'Actual category '+index})));
    const membership=randomUUID();await db.insert(storeMembersTable).values({id:membership,storeId:business,userId:staff,invitedBy:owner,permissions:['catalog.read'],enabled:true});
    server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const port=(server.address() as {port:number}).port;
    const request=async(categoryId:string,user:string|null=owner,body?:unknown,csrf=true)=>{const credentials=user?auth.get(user):undefined;const response=await fetch(`http://127.0.0.1:${port}/api/categories/${categoryId}/presentation`,{method:body===undefined?'GET':'PUT',headers:{'content-type':'application/json',...(credentials?{cookie:credentials.cookie,...(csrf?{'x-csrf-token':credentials.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
    const input={emoji:'🎮',imageUrl:'https://example.com/real-category.jpg'};
    await t.test('existing category defaults and owner persistence roundtrip',async()=>{
      assert.deepEqual((await request(categoryIds[0])).data,{emoji:'📂',imageUrl:null});
      assert.equal((await request(categoryIds[0],owner,input)).status,200);assert.deepEqual((await request(categoryIds[0])).data,input);
      const [record]=await db.select({imageUrl:categoriesTable.imageUrl,emoji:categoriesTable.emoji}).from(categoriesTable).where(eq(categoriesTable.id,categoryIds[0]));assert.deepEqual(record,input);
      assert.equal((await request(categoryIds[2],owner,input)).status,200);
    });
    await t.test('anonymous, other owner, missing CSRF and Free writes are denied',async()=>{
      assert.equal((await request(categoryIds[0],null)).status,401);assert.equal((await request(categoryIds[0],other)).status,404);
      assert.equal((await request(categoryIds[0],owner,input,false)).status,403);assert.equal((await request(categoryIds[1],owner,input)).status,403);
      assert.deepEqual((await request(categoryIds[1])).data,{emoji:'📂',imageUrl:null});
    });
    await t.test('malformed presentation never updates stored category metadata',async()=>{
      for(const value of [{...input,imageUrl:'http://example.com/image.jpg'},{...input,imageUrl:'https://user:password@example.com/a.jpg'},{...input,emoji:'script'},{emoji:'📂',imageUrl:42}])assert.equal((await request(categoryIds[0],owner,value)).status,400);
      assert.deepEqual((await request(categoryIds[0])).data,input);
    });
    await t.test('staff scopes explicitly separate reading and writing and never cross stores',async()=>{
      assert.equal((await request(categoryIds[0],staff)).status,200);assert.equal((await request(categoryIds[0],staff,input)).status,404);assert.equal((await request(categoryIds[2],staff)).status,404);
      await db.update(storeMembersTable).set({permissions:['catalog.read','catalog.write']}).where(eq(storeMembersTable.id,membership));
      assert.equal((await request(categoryIds[0],staff,{emoji:'🛍️',imageUrl:null})).status,200);assert.deepEqual((await request(categoryIds[0],staff)).data,{emoji:'🛍️',imageUrl:null});
    });
    await t.test('deleted categories and revoked memberships reject stale requests',async()=>{
      await db.update(storeMembersTable).set({enabled:false}).where(eq(storeMembersTable.id,membership));assert.equal((await request(categoryIds[0],staff)).status,404);
      await db.update(categoriesTable).set({isDeleted:true}).where(eq(categoriesTable.id,categoryIds[0]));assert.equal((await request(categoryIds[0])).status,404);assert.equal((await request(categoryIds[0],owner,input)).status,404);
    });
  }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await db.delete(storesTable).where(inArray(storesTable.id,storeIds));await db.delete(usersTable).where(inArray(usersTable.id,userIds));await pool.end();}
});
