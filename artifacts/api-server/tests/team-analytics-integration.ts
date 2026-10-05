import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import app from '../src/app';
import { db, pool, usersTable, sessionsTable, storesTable, storeSettingsTable, productsTable, customersTable, ordersTable, orderItemsTable, growthJobsTable } from '@workspace/db';
import { storeMembersTable } from '../../../lib/db/src/schema/staff';
import { passwordHash, sha256 } from '../src/lib/security';

test('real HTTP team and analytics enforce store, membership, plan and financial scopes', async t => {
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, 'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech');
  const owner=randomUUID(),staff=randomUUID(),other=randomUUID(),business=randomUUID(),free=randomUUID();
  const stores=[business,free],userIds=[owner,staff,other]; const cookies=new Map<string,{cookie:string;csrf:string}>();
  const now=new Date(),yesterday=new Date(Date.now()-86400000); const product=randomUUID(),secondProduct=randomUUID();
  const orderIds=[randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    for(const id of userIds){const token=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();await db.insert(usersTable).values({id,name:'Team acceptance',email:`team-${id}@example.invalid`,passwordHash:await passwordHash('Test-'+randomUUID())});await db.insert(sessionsTable).values({id:randomUUID(),userId:id,tokenHash:sha256(token),csrfHash:sha256(csrf),expiresAt:new Date(Date.now()+3600000)});cookies.set(id,{cookie:`lootbot_session=${token}; lootbot_csrf=${csrf}`,csrf});}
    await db.insert(storesTable).values([{id:business,ownerId:owner,name:'Team QA',slug:'team-'+business,currency:'USD'},{id:free,ownerId:owner,name:'Free QA',slug:'free-'+free,currency:'USD'}]);
    await db.insert(storeSettingsTable).values([{storeId:business,settings:{plan:{code:'BUSINESS'}}},{storeId:free,settings:{plan:{code:'FREE'}}}]);
    await db.insert(productsTable).values([{id:product,storeId:business,name:'Metrics product',price:'10',stock:2,isPublished:true},{id:secondProduct,storeId:business,name:'Draft product',price:'8',stock:10,isPublished:false}]);
    await db.insert(customersTable).values([{id:randomUUID(),storeId:business,telegramUserId:'960101',telegramChatId:'960101',name:'A customer',state:{experimentVisits:{'qa:A':true}},createdAt:now},{id:randomUUID(),storeId:business,telegramUserId:'960102',telegramChatId:'960102',name:'B customer',optedIn:false,state:{experimentVisits:{'qa:B':true,'qa:A':true}},createdAt:now}]);
    await db.insert(ordersTable).values([
      {id:orderIds[0],storeId:business,telegramChatId:'960101',telegramUserId:'960101',customerName:'A customer',currency:'USD',total:'20',status:'confirmed',paymentStatus:'paid',createdAt:now},
      {id:orderIds[1],storeId:business,telegramChatId:'960102',telegramUserId:'960102',customerName:'B customer',currency:'USD',total:'30',status:'fulfilled',paymentStatus:'paid',createdAt:yesterday},
      {id:orderIds[2],storeId:business,telegramChatId:'960101',customerName:'A customer',currency:'USD',total:'40',status:'cancelled',paymentStatus:'refunded',createdAt:now},
      {id:orderIds[3],storeId:business,telegramChatId:'960101',customerName:'A customer',currency:'USD',total:'10',status:'pending',paymentStatus:'unpaid',createdAt:now},
      {id:orderIds[4],storeId:free,telegramChatId:'960103',customerName:'Other store',currency:'USD',total:'999',status:'fulfilled',paymentStatus:'paid',createdAt:now},
    ]);
    await db.insert(orderItemsTable).values([{id:randomUUID(),orderId:orderIds[0],productId:product,productName:'Metrics product',quantity:2,unitPrice:'10',lineTotal:'20'},{id:randomUUID(),orderId:orderIds[1],productId:product,productName:'Metrics product',quantity:3,unitPrice:'10',lineTotal:'30'}]);
    await db.insert(growthJobsTable).values({id:randomUUID(),storeId:business,dedupeKey:'team-'+randomUUID(),payload:{kind:'EVENT'},status:'failed',lastError:'Isolated test failure'});
    server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server!.once('listening',resolve));const port=(server.address() as {port:number}).port;
    const request=async(path:string,user:string|null=owner,body?:unknown,method=body===undefined?'GET':'POST',csrf=true)=>{const auth=user?cookies.get(user):undefined;const response=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'content-type':'application/json',...(auth?{cookie:auth.cookie,...(csrf?{'x-csrf-token':auth.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,data:await response.json()};};
    let memberId='';
    await t.test('team writes require owner, CSRF, Business, existing account and allowlisted scopes',async()=>{
      assert.equal((await request(`/stores/${business}/team`,null)).status,401);
      assert.equal((await request(`/stores/${business}/team`,other)).status,404);
      assert.equal((await request(`/stores/${business}/team`,owner,{email:`team-${staff}@example.invalid`,permissions:['catalog.read']},'POST',false)).status,403);
      assert.equal((await request(`/stores/${free}/team`,owner,{email:`team-${staff}@example.invalid`,permissions:['catalog.read']})).status,403);
      assert.equal((await request(`/stores/${business}/team`,owner,{email:`team-${staff}@example.invalid`,permissions:['SUPERADMIN']})).status,400);
      assert.equal((await request(`/stores/${business}/team`,owner,{email:'does-not-exist@example.invalid',permissions:['catalog.read']})).status,400);
      const invited=await request(`/stores/${business}/team`,owner,{email:`TEAM-${staff}@EXAMPLE.INVALID`,permissions:['catalog.write','orders.read','overview.read','analytics.read']});assert.equal(invited.status,201);memberId=invited.data.id;assert.ok(invited.data.permissions.includes('catalog.read'));
      const [user]=await db.select().from(usersTable).where(eq(usersTable.id,staff));assert.equal(user.role,'OWNER');
    });
    await t.test('scoped staff sees only permitted store and cannot change team, payment or Super Admin',async()=>{
      const access=await request(`/stores/${business}/access`,staff);assert.equal(access.status,200);assert.equal(access.data.isOwner,false);
      const list=await request('/stores',staff);assert.equal(list.status,200);assert.deepEqual(list.data.map((store:any)=>store.id),[business]);
      assert.equal((await request(`/products?storeId=${business}&pageSize=10`,staff)).status,200);
      assert.equal((await request(`/products?storeId=${free}&pageSize=10`,staff)).status,404);
      assert.equal((await request(`/stores/${business}/team`,staff)).status,404);
      assert.equal((await request(`/stores/${free}/team/${memberId}`,owner,{enabled:false},'PATCH')).status,404);
      assert.equal((await request(`/orders/${orderIds[0]}/payment`,staff,{status:'refunded'},'PATCH')).status,404);
      assert.equal((await request('/admin/overview',staff)).status,403);
      assert.equal((await request(`/stores/${business}/plan-catalog`,staff)).status,200);
    });
    await t.test('real analytics count only paid amounts, owned orders and real variant visits',async()=>{
      const response=await request(`/stores/${business}/analytics?days=7`);assert.equal(response.status,200);const data=response.data;
      assert.equal(data.totals.orders,4);assert.equal(data.totals.revenue,50);assert.equal(data.totals.averagePaidOrder,25);assert.equal(data.totals.newCustomers,2);assert.equal(data.daily.length,7);assert.equal(data.daily.reduce((sum:number,day:any)=>sum+day.orders,0),4);assert.equal(data.topProducts[0].quantity,5);assert.equal(data.topProducts[0].revenue,50);
      assert.deepEqual(data.experimentVisits,[{variant:'qa:A',customers:2},{variant:'qa:B',customers:1}]);
      assert.equal((await request(`/stores/${business}/analytics?days=15`)).status,400);
      assert.equal((await request(`/stores/${free}/analytics?days=90`)).status,403);
      assert.equal((await request(`/stores/${business}/analytics`,other)).status,404);
      const summary=await request(`/stores/${business}/workspace-summary`);assert.equal(summary.status,200);assert.equal(summary.data.orderCount,4);assert.equal(summary.data.revenue,50);assert.equal(summary.data.customers,2);assert.equal(summary.data.optedInCustomers,1);assert.equal(summary.data.pendingOrders,1);assert.equal(summary.data.lowStockProducts,1);assert.equal(summary.data.publishedProducts,1);assert.equal(summary.data.jobs.failed,1);assert.equal(summary.data.telegram.linked,false);
    });
    await t.test('staff analytics and overview redact financial data on server',async()=>{
      const analytics=await request(`/stores/${business}/analytics`,staff);assert.equal(analytics.status,200);assert.equal(analytics.data.canViewFinancials,false);assert.equal(analytics.data.totals.revenue,null);assert.equal(analytics.data.totals.averagePaidOrder,null);assert.ok(analytics.data.daily.every((day:any)=>day.revenue===null));assert.ok(analytics.data.topProducts.every((item:any)=>item.revenue===null));assert.deepEqual(analytics.data.topCustomers,[]);assert.deepEqual(analytics.data.payments,[]);assert.equal(analytics.data.exportEnabled,false);
      const summary=await request(`/stores/${business}/workspace-summary`,staff);assert.equal(summary.status,200);assert.equal(summary.data.revenue,null);assert.ok(summary.data.recentOrders.every((order:any)=>order.total===null));
    });
    await t.test('membership edits and revocation apply to an existing session immediately',async()=>{
      assert.equal((await request(`/stores/${business}/team/${memberId}`,owner,{permissions:['orders.read']},'PATCH')).status,200);
      assert.equal((await request(`/stores/${business}/analytics`,staff)).status,404);
      assert.equal((await request(`/products?storeId=${business}`,staff)).status,404);
      assert.equal((await request(`/orders?storeId=${business}`,staff)).status,200);
      assert.equal((await request(`/stores/${business}/team/${memberId}`,owner,{enabled:false},'PATCH')).status,200);
      assert.equal((await request(`/orders?storeId=${business}`,staff)).status,404);
      assert.deepEqual((await request('/stores',staff)).data,[]);
    });
    await t.test('downgrades suspend all staff access but owner can revoke old memberships',async()=>{
      await request(`/stores/${business}/team/${memberId}`,owner,{enabled:true},'PATCH');
      await db.update(storeSettingsTable).set({settings:{plan:{code:'FREE'}}}).where(eq(storeSettingsTable.storeId,business));
      assert.equal((await request(`/stores/${business}/access`,staff)).status,404);
      assert.equal((await request(`/orders?storeId=${business}`,staff)).status,404);
      const roster=await request(`/stores/${business}/team`);assert.equal(roster.status,200);assert.equal(roster.data.enabled,false);assert.equal(roster.data.members.length,1);
      assert.equal((await request(`/stores/${business}/team/${memberId}`,owner,{enabled:false},'PATCH')).status,200);
      assert.equal((await request(`/stores/${business}/team/${memberId}`,owner,{enabled:true},'PATCH')).status,403);
    });
  }finally{
    if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    await db.delete(storesTable).where(inArray(storesTable.id,stores));
    await db.delete(usersTable).where(inArray(usersTable.id,userIds));
    await pool.end();
  }
});
