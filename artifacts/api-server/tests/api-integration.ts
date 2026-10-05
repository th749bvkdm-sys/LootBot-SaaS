import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import app from '../src/app';
import { db,pool,usersTable,sessionsTable,storesTable,storeSettingsTable,productsTable,categoriesTable,customersTable,ordersTable,orderItemsTable,growthJobsTable,growthResourcesTable } from '@workspace/db';
import { storeMembersTable } from '../../../lib/db/src/schema/staff';
import { sha256,passwordHash } from '../src/lib/security';
import { DEFAULT_HOME_CONFIGURATION } from '../src/lib/telegram-home-configuration';
import { DEFAULT_BUSINESS_CONFIGURATION } from '../src/lib/telegram-business-configuration';
import { handleTelegramUpdate } from '../src/lib/telegram-bot-manager';
import { businessViewerData,validateBusinessReferences } from '../src/lib/telegram-business-data';
import { renderStoreScreen } from '../src/lib/telegram-store-screens';
import { defaultGrowthConfiguration } from '../src/lib/growth-configuration';

test('isolated database and real HTTP protect studio, references, roles, plans and Telegram customer scope', async t=>{
  assert.equal(new URL(process.env.DATABASE_URL!).hostname,'ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech');
  t.after(async()=>{if(!pool.ended)await pool.end();});
  for (const name of ['0002_telegram_health.sql','0003_growth_execution.sql','0004_product_presentation.sql','0005_customer_commerce.sql','0006_store_team.sql','0007_category_presentation.sql']) await pool.query(await readFile(`../../lib/db/migrations/${name}`,'utf8'));
  const owner=randomUUID(),other=randomUUID(),staff=randomUUID(),admin=randomUUID();const stores=[randomUUID(),randomUUID(),randomUUID()];const [business,free,pro]=stores;const customerId=randomUUID(),category=randomUUID(),product=randomUUID(),foreignProduct=randomUUID();
  const tokens=new Map<string,{cookie:string;csrf:string}>();const password='Test-'+randomUUID();
  for(const id of [owner,other,staff,admin]){await db.insert(usersTable).values({id,name:'V2 acceptance',email:`qa-${id}@example.invalid`,role:id===admin?'SUPERADMIN':'OWNER',passwordHash:await passwordHash(password)});const token=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();await db.insert(sessionsTable).values({id:randomUUID(),userId:id,tokenHash:sha256(token),csrfHash:sha256(csrf),expiresAt:new Date(Date.now()+3600000)});tokens.set(id,{cookie:`lootbot_session=${token}; lootbot_csrf=${csrf}`,csrf});}
  await db.insert(storesTable).values(stores.map((id,i)=>({id,ownerId:owner,name:`V2 QA ${i}`,slug:`v2-qa-${id}`,currency:'USD'})));
  await db.insert(storeSettingsTable).values(stores.map((storeId,i)=>({storeId,settings:{plan:{code:['BUSINESS','FREE','PRO'][i]},cartEnabled:true,favoritesEnabled:true},pointsEnabled:true,referralsEnabled:true,reviewsEnabled:true,couponsEnabled:true})));
  await db.insert(storeMembersTable).values({id:randomUUID(),storeId:business,userId:staff,invitedBy:owner,permissions:['catalog.read','orders.read','telegram.design'],enabled:true});
  await db.insert(categoriesTable).values({id:category,storeId:business,name:'Category'});
  await db.insert(productsTable).values([{id:product,storeId:business,categoryId:category,name:'Owned product',description:'QA real record',price:'10.00',oldPrice:'20.00',stock:5,featured:true,isPublished:true},{id:foreignProduct,storeId:free,name:'Foreign product',price:'3.00',stock:5,isPublished:true}]);
  await db.insert(customersTable).values({id:customerId,storeId:business,telegramUserId:'951001',telegramChatId:'951001',name:'QA customer',vipLevel:2});
  const orderIds=[randomUUID(),randomUUID()];await db.insert(ordersTable).values(orderIds.map((id,i)=>({id,storeId:business,telegramUserId:i===0?'951001':'951002',telegramChatId:i===0?'951001':'951002',customerName:'QA',currency:'USD',total:'10.00'})));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as {port:number}).port;
  const request=async(path:string,user:string|null=owner,body?:unknown,csrf=true,method=body===undefined?'GET':'POST')=>{let auth=user?tokens.get(user):undefined;if(!user&&body!==undefined&&csrf){const preauth=await fetch(`http://127.0.0.1:${port}/api/auth/csrf`);const {token}=await preauth.json();auth={cookie:`lootbot_csrf=${token}`,csrf:token};}const res=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'content-type':'application/json',...(auth?{cookie:auth.cookie,...(csrf?{'x-csrf-token':auth.csrf}:{})}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:res.status,data:await res.json(),setCookies:res.headers.getSetCookie()};};
  const studio=`/stores/${business}/telegram/studio`,bus=`/stores/${business}/telegram/business-studio`;
  try {
    await t.test('SPA navigation survives malformed Accept while unknown API routes retain JSON 404',async()=>{
      for(const accept of ['not-a-media-type','text/html, */*;q=0.8, invalid-token']) {
        const page=await fetch(`http://127.0.0.1:${port}/dashboard/settings`,{headers:{accept}});
        assert.equal(page.status,200);assert.match(page.headers.get('content-type')??'',/text\/html/);assert.match(await page.text(),/<!doctype html>/i);
      }
      const missing=await fetch(`http://127.0.0.1:${port}/api/acceptance-missing`,{headers:{accept:'not-a-media-type'}});
      assert.equal(missing.status,404);assert.match(missing.headers.get('content-type')??'',/application\/json/);assert.equal(typeof(await missing.json()).error,'string');
    });
    await t.test('login checks real hash and returns valid session; wrong password and SuperAdmin access rejected',async()=>{
      const logged=await request('/auth/login',null,{email:`qa-${owner}@example.invalid`,password});assert.equal(logged.status,200);
      assert.equal(logged.data.user.id,owner);assert.equal(logged.data.user.role,'OWNER');assert.ok(logged.setCookies.some(cookie=>cookie.startsWith('lootbot_session=')));
      tokens.set(owner,{cookie:logged.setCookies.map(cookie=>cookie.split(';')[0]).join('; '),csrf:logged.data.csrfToken});
      const me=await request('/auth/me',owner);assert.equal(me.status,200);assert.equal(me.data.id,owner);assert.equal(me.data.role,'OWNER');
      assert.equal((await request('/auth/login',null,{email:`qa-${owner}@example.invalid`,password:'wrong-password'})).status,401);
      assert.equal((await request('/admin/overview',owner)).status,403);
    });
    await t.test('Super Admin reads actual overview, feature catalog and health while regular accounts are denied',async()=>{
      const logged=await request('/auth/login',null,{email:`qa-${admin}@example.invalid`,password});assert.equal(logged.status,200);assert.equal(logged.data.user.role,'SUPERADMIN');
      tokens.set(admin,{cookie:logged.setCookies.map(cookie=>cookie.split(';')[0]).join('; '),csrf:logged.data.csrfToken});assert.equal((await request('/auth/me',admin)).data.role,'SUPERADMIN');
      const overview=await request('/admin/overview',admin);assert.equal(overview.status,200);assert.ok(overview.data.stats.users>=4);assert.ok(overview.data.stores.some((s:any)=>s.id===business));
      const plans=await request('/admin/plans',admin);assert.equal(plans.status,200);assert.ok(plans.data.catalog.BUSINESS);assert.ok(plans.data.featureMatrix.some((f:any)=>f.key==='telegram.studio'));
      const health=await request('/admin/health',admin);assert.equal(health.status,200);assert.equal(health.data.database,'healthy');assert.equal(health.data.api,'healthy');
      assert.equal((await request('/admin/plans',owner)).status,403);assert.equal((await request('/admin/health',other)).status,403);
    });
    await t.test('session, CSRF, other owner and Free/Pro Business gates',async()=>{
      assert.equal((await request(studio,null)).status,401);assert.equal((await request(studio,other)).status,404);
      assert.equal((await request(studio+'/draft',owner,{configuration:DEFAULT_HOME_CONFIGURATION,revision:0},false)).status,403);
      assert.equal((await request(`/stores/${free}/telegram/studio/draft`,owner,{configuration:DEFAULT_HOME_CONFIGURATION,revision:0})).status,403);
      assert.equal((await request(`/stores/${pro}/telegram/business-studio/draft`,owner,{configuration:DEFAULT_BUSINESS_CONFIGURATION,revision:0})).status,403);
      assert.equal((await request(`/stores/${free}/commerce/coupons`,owner,{code:'SALE',percent:20,minimum:0,maxUses:5,enabled:true,expiresAt:null})).status,403);
    });
    await t.test('Studio selectors search and paginate every owned record, preserve selected labels and enforce private customer access',async()=>{
      const count=112,productIds=Array.from({length:count},()=>randomUUID()),categoryIds=Array.from({length:count},()=>randomUUID()),customerIds=Array.from({length:count},()=>randomUUID());
      const label=(kind:string,index:number)=>`Selector ${kind} ${String(index).padStart(3,'0')}`;
      await db.insert(productsTable).values(productIds.map((id,index)=>({id,storeId:business,name:label('product',index),price:'1.00',stock:1,isPublished:true})));
      await db.insert(categoriesTable).values(categoryIds.map((id,index)=>({id,storeId:business,name:label('category',index)})));
      await db.insert(customersTable).values(customerIds.map((id,index)=>({id,storeId:business,telegramUserId:String(700100+index),telegramChatId:String(700100+index),name:label('customer',index),optedIn:index!==111,vipLevel:9,points:500})));
      const path=(kind:string)=>`${studio}/options/${kind}`;
      try {
        assert.equal((await request(path('products'),null)).status,401);assert.equal((await request(path('products'),other)).status,404);
        assert.equal((await request(`/stores/${free}/telegram/studio/options/products`)).status,403);assert.equal((await request(`/stores/${pro}/telegram/studio/options/products`)).status,200);
        for(const [kind,ids,singular] of [['products',productIds,'product'],['categories',categoryIds,'category'],['customers',customerIds,'customer']] as const) {
          const first=await request(path(kind)+'?page=1');assert.equal(first.status,200);assert.equal(first.data.options.length,50);assert.equal(first.data.hasMore,true);
          const second=await request(path(kind)+'?page=2');assert.equal(second.status,200);assert.equal(second.data.options.length,50);assert.equal(second.data.hasMore,true);assert.ok(!second.data.options.some((option:any)=>first.data.options.some((prior:any)=>prior.value===option.value)));
          const third=await request(path(kind)+'?page=3');assert.equal(third.status,200);assert.equal(third.data.hasMore,false);assert.ok(third.data.options.some((option:any)=>option.value===ids[111]));
          const searched=await request(path(kind)+`?q=${encodeURIComponent(label(singular,111))}`);assert.equal(searched.status,200);assert.deepEqual(searched.data.options,[{value:ids[111],label:label(singular,111)}]);
          const selected=await request(path(kind)+`?q=${encodeURIComponent(label(singular,0))}&selected=${ids[111]}`);assert.equal(selected.status,200);assert.deepEqual(selected.data.options,[{value:ids[0],label:label(singular,0)}]);assert.deepEqual(selected.data.selectedOption,{value:ids[111],label:label(singular,111)});
          for(const option of [...first.data.options,selected.data.selectedOption])assert.deepEqual(Object.keys(option).sort(),['label','value']);
          assert.equal((await request(path(kind),staff)).status,kind==='customers'?403:200);
          for(const query of ['q=a&q=b',`q=${'x'.repeat(101)}`,'page=0','page=100001','selected=bad'])assert.equal((await request(path(kind)+'?'+query)).status,400,`${kind}: ${query}`);
        }
        const noWildcard=await request(path('products')+'?q=%25');assert.equal(noWildcard.status,200);assert.deepEqual(noWildcard.data.options,[]);
        assert.equal((await request(path('products')+`?selected=${foreignProduct}`)).data.selectedOption,null);
        await db.update(productsTable).set({isPublished:false}).where(eq(productsTable.id,productIds[111]));assert.equal((await request(path('products')+`?selected=${productIds[111]}`)).data.selectedOption,null);
        await db.update(productsTable).set({isDeleted:true}).where(eq(productsTable.id,productIds[110]));assert.equal((await request(path('products')+`?selected=${productIds[110]}`)).data.selectedOption,null);
        await db.update(categoriesTable).set({isDeleted:true}).where(eq(categoriesTable.id,categoryIds[111]));assert.equal((await request(path('categories')+`?selected=${categoryIds[111]}`)).data.selectedOption,null);
        const optedOut=await request(path('customers')+`?selected=${customerIds[111]}`);assert.equal(optedOut.status,200);assert.deepEqual(optedOut.data.selectedOption,{value:customerIds[111],label:label('customer',111)});
        assert.equal((await request(`${studio}/options/unknown`)).status,400);
        await db.update(storeMembersTable).set({permissions:['catalog.read','orders.read','telegram.design','customers.read']}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));
        const customerLabels=await request(path('customers')+`?selected=${customerIds[111]}`,staff);assert.equal(customerLabels.status,200);assert.deepEqual(Object.keys(customerLabels.data.selectedOption).sort(),['label','value']);
      } finally {
        await db.update(storeMembersTable).set({permissions:['catalog.read','orders.read','telegram.design']}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));
        await db.delete(productsTable).where(inArray(productsTable.id,productIds));await db.delete(categoriesTable).where(inArray(categoriesTable.id,categoryIds));await db.delete(customersTable).where(inArray(customersTable.id,customerIds));
      }
    });
    await t.test('draft isolation, revision conflict and saved-draft publication',async()=>{
      const c={...DEFAULT_HOME_CONFIGURATION,welcomeMessage:'Draft only',layout:'offers-first'};
      const saved=await request(studio+'/draft',owner,{configuration:c,revision:0});assert.equal(saved.status,200);assert.equal(saved.data.published,null);
      assert.equal((await request(studio+'/draft',owner,{configuration:c,revision:0})).status,409);
      const pub=await request(studio+'/publish',owner,{configuration:{invalid:true},revision:1});assert.equal(pub.status,200);assert.equal(pub.data.published.welcomeMessage,'Draft only');
    });
    await t.test('server preview searches real products, private orders and rejects buying',async()=>{
      const body={configuration:DEFAULT_HOME_CONFIGURATION,customerId};
      const search=await request(studio+'/preview',owner,{...body,callbackData:'lb:search:1',search:'Owned'});assert.equal(search.status,200);assert.match(search.data.preview.text,/Owned product/);
      const orders=await request(studio+'/preview',owner,{...body,callbackData:'lb:orders:1'});assert.ok(orders.data.preview.keyboard.flat().some((b:any)=>b.callback_data.includes(orderIds[0])));assert.ok(!JSON.stringify(orders.data.preview).includes(orderIds[1]));
      assert.equal((await request(studio+'/preview',owner,{...body,callbackData:`lb:buy:${product.replaceAll('-','').slice(0,12)}`})).status,400);
    });
    await t.test('both Studio previews reject malformed customer, callback, search and state inputs as client errors',async()=>{
      const invalid=[{customerId:'bad'},{customerId:{id:customerId}},{callbackData:{callback:'lb:products:1'}},{callbackData:'x'.repeat(65)},{callbackData:'invalid-callback'},{search:{value:'Owned'}},{search:'x'.repeat(121)},{state:'invented-state'},{state:{value:'success'}}];
      for(const path of [studio,bus]) for(const bad of invalid) {
        const configuration=path===studio?DEFAULT_HOME_CONFIGURATION:DEFAULT_BUSINESS_CONFIGURATION;
        const response=await request(path+'/preview',owner,{configuration,screenId:'home',returning:false,customerId,...bad});
        assert.equal(response.status,400,`${path}: ${JSON.stringify(bad)}`);
      }
      for(const screenId of [undefined,'missing-screen',{id:'home'}]) assert.equal((await request(bus+'/preview',owner,{configuration:DEFAULT_BUSINESS_CONFIGURATION,screenId,returning:false})).status,400);
    });
    await t.test('Business references cannot cross stores; full block sources use real records; deleted target blocks publication',async()=>{
      const config=structuredClone(DEFAULT_BUSINESS_CONFIGURATION);config.screens[0].blocks.push({id:'product',type:'PRODUCT',text:'',target:foreignProduct,enabled:true} as any);assert.equal((await request(bus+'/draft',owner,{configuration:config,revision:0})).status,400);
      config.screens[0].blocks[1].target=product;config.experiment={id:'qa',enabled:true,ratio:50};
      assert.equal((await request(bus+'/draft',owner,{configuration:config,revision:0})).status,200);
      const preview=await request(bus+'/preview',owner,{configuration:config,screenId:'home',returning:false,customerId});assert.match(preview.data.preview.text,/Owned product/);
      await db.update(productsTable).set({isPublished:false}).where(eq(productsTable.id,product));assert.equal((await request(bus+'/publish',owner,{revision:1})).status,409);await db.update(productsTable).set({isPublished:true}).where(eq(productsTable.id,product));
      assert.equal((await request(bus+'/publish',owner,{revision:1})).status,200);
    });
    await t.test('staff manage grants order preparation while payment and other stores remain protected', async()=>{
      const permissions=['catalog.read','orders.read','orders.manage','telegram.design'];
      await db.update(storeMembersTable).set({permissions}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));
      assert.equal((await request(`/orders/${orderIds[1]}`,staff,{status:'confirmed'},true,'PATCH')).status,200);
      assert.equal((await request(`/orders/${orderIds[1]}`,staff,{status:'fulfilled'},true,'PATCH')).status,200);
      assert.equal((await request(`/orders/${orderIds[1]}/payment`,staff,{status:'paid'},true,'PATCH')).status,404);
      const foreignOrder=randomUUID();await db.insert(ordersTable).values({id:foreignOrder,storeId:free,telegramUserId:'951001',telegramChatId:'951001',customerName:'QA',currency:'USD',total:'1.00'});
      assert.equal((await request(`/orders/${foreignOrder}`,staff,{status:'confirmed'},true,'PATCH')).status,404);
      await db.update(storeMembersTable).set({permissions:['catalog.read','orders.read','telegram.design']}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));
      assert.equal((await request(`/orders/${orderIds[0]}`,staff,{status:'confirmed'},true,'PATCH')).status,404);
    });
    await t.test('customer read and marketing staff cannot disclose or infer financial facts',async()=>{
      await db.update(storeMembersTable).set({permissions:['catalog.read','orders.read','telegram.design','customers.read','customers.manage','marketing.manage','automation.manage']}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));
      const paidOrder=randomUUID(),financialSegment=randomUUID(),nestedSegment=randomUUID();
      await db.insert(ordersTable).values({id:paidOrder,storeId:business,telegramUserId:'951001',telegramChatId:'951001',customerName:'QA',currency:'USD',total:'23.45',status:'fulfilled',paymentStatus:'paid'});
      const segment=defaultGrowthConfiguration('segment');segment.condition={field:'TOTAL_SPEND_GREATER_THAN',operator:'>',value:1};
      await db.insert(growthResourcesTable).values({id:financialSegment,storeId:business,kind:'segment',name:'Financial segment',configuration:segment as unknown as Record<string,unknown>,enabled:true});
      const nested=defaultGrowthConfiguration('segment');nested.condition={field:'CUSTOMER_SEGMENT',operator:'IN',value:[financialSegment]};
      await db.insert(growthResourcesTable).values({id:nestedSegment,storeId:business,kind:'segment',name:'Derived financial segment',configuration:nested as unknown as Record<string,unknown>,enabled:true});
      await db.update(customersTable).set({segments:[financialSegment,nestedSegment]}).where(eq(customersTable.id,customerId));
      const path=`/stores/${business}/growth`;
      const ownerCustomers=await request(path+'/customers',owner);assert.equal(ownerCustomers.status,200);assert.equal(ownerCustomers.data[0].facts.TOTAL_SPEND_GREATER_THAN,23.45);
      const staffCustomers=await request(path+'/customers',staff);assert.equal(staffCustomers.status,200);
      assert.equal(Object.hasOwn(staffCustomers.data[0].facts,'TOTAL_SPEND_GREATER_THAN'),false);assert.equal(Object.hasOwn(staffCustomers.data[0].facts,'ORDER_VALUE'),false);for(const segmentId of [financialSegment,nestedSegment]){assert.ok(!staffCustomers.data[0].facts.CUSTOMER_SEGMENT.includes(segmentId));assert.ok(!staffCustomers.data[0].segments.includes(segmentId));}
      const plain=defaultGrowthConfiguration('broadcast');const preview=await request(path+'/preview',staff,{configuration:plain,customerId});assert.equal(preview.status,200);assert.equal(Object.hasOwn(preview.data.facts,'TOTAL_SPEND_GREATER_THAN'),false);
      const financial={...plain,condition:{field:'TOTAL_SPEND_GREATER_THAN',operator:'>',value:20}};
      assert.equal((await request(path+'/preview',staff,{configuration:financial,customerId})).status,403);
      assert.equal((await request(path+'/preview',owner,{configuration:financial,customerId})).status,200);
      assert.equal((await request(path+'/resources',staff,{configuration:financial,name:'Inference attempt',enabled:false})).status,403);
      assert.equal((await request(path+'/preview',staff,{configuration:{...plain,audience:{type:'segment',segmentId:financialSegment}},customerId})).status,403);
      assert.ok(!(await request(path,staff)).data.resources.some((r:any)=>r.id===financialSegment));
      for(const condition of [{field:'TOTAL_SPEND_GREATER_THAN',operator:'>',value:20},{field:'ORDER_VALUE',operator:'=',value:0},{field:'CUSTOMER_SEGMENT',operator:'NOT_IN',value:[financialSegment]},{field:'CUSTOMER_SEGMENT',operator:'NOT_IN',value:[nestedSegment]}]) {
        const configuration=structuredClone(DEFAULT_BUSINESS_CONFIGURATION);configuration.screens[0].buttons[0].condition=condition as any;
        const body={configuration,screenId:'home',returning:false,customerId};assert.equal((await request(bus+'/preview',staff,body)).status,403);assert.equal((await request(bus+'/preview',owner,body)).status,200);
      }
      await db.update(customersTable).set({segments:[]}).where(eq(customersTable.id,customerId));await db.delete(growthResourcesTable).where(inArray(growthResourcesTable.id,[financialSegment,nestedSegment]));await db.delete(ordersTable).where(eq(ordersTable.id,paidOrder));
      await db.update(storeMembersTable).set({permissions:['catalog.read','orders.read','telegram.design']}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));
    });
    await t.test('scoped staff access remains explicit and revoked with plan/membership',async()=>{
      assert.equal((await request(`/products?storeId=${business}&pageSize=10`,staff)).status,200);assert.equal((await request(`/stores/${business}/products`,staff,{name:'Bad write',price:1,stock:1,isPublished:true,description:''})).status,404);
      assert.equal((await request(studio,staff)).status,200);assert.equal((await request(studio+'/preview',staff,{configuration:DEFAULT_HOME_CONFIGURATION,customerId,callbackData:'lb:orders:1'})).status,403);assert.equal((await request(bus+'/preview',staff,{configuration:DEFAULT_BUSINESS_CONFIGURATION,screenId:'home',returning:false,customerId})).status,403);assert.equal((await request(`/stores/${business}/team`,staff)).status,404);assert.equal((await request(`/orders/${orderIds[0]}/payment`,staff,{status:'paid'},true,'PATCH')).status,404);
      await db.update(storeMembersTable).set({enabled:false}).where(and(eq(storeMembersTable.storeId,business),eq(storeMembersTable.userId,staff)));assert.equal((await request(studio,staff)).status,404);
    });
    await t.test('paid orders can be fulfilled after real payment update',async()=>{
      assert.equal((await request(`/orders/${orderIds[0]}`,owner,{status:'confirmed'},true,'PATCH')).status,200);
      assert.equal((await request(`/orders/${orderIds[0]}/payment`,owner,{status:'paid'},true,'PATCH')).status,200);
      assert.equal((await request(`/orders/${orderIds[0]}`,owner,{status:'fulfilled'},true,'PATCH')).status,200);
    });
    await t.test('Telegram handler /start, real catalogs and stale callbacks tested with isolated transport',async()=>{
      const nativeFetch=globalThis.fetch;const sent:any[]=[];globalThis.fetch=(async(input:any,options:any)=>{if(String(input).startsWith('https://api.telegram.org/')){sent.push({method:String(input).split('/').at(-1),body:JSON.parse(options.body)});return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200});}return nativeFetch(input,options);}) as typeof fetch;
      const bot={tokenHash:'qa-only',token:'qa-only',controller:new AbortController(),nextOffset:0};const from={id:951001,first_name:'QA customer'};const message={chat:{id:951001,type:'private'},from,text:'/start'};
      try {await handleTelegramUpdate(business,bot,{update_id:99001,message});const home=sent.find(c=>c.method==='sendMessage');assert.ok(home.body.reply_markup.inline_keyboard.flat().some((b:any)=>b.callback_data));assert.match(home.body.text,/Owned product/);
        sent.length=0;await handleTelegramUpdate(business,bot,{update_id:99002,callback_query:{id:'qa1',from,data:'lb:orders:1',message:{message_id:1,chat:message.chat}}});const orderMessage=sent.find(c=>c.method==='sendMessage');assert.ok(!JSON.stringify(orderMessage).includes(orderIds[1]));
        sent.length=0;await handleTelegramUpdate(business,bot,{update_id:99003,callback_query:{id:'qa2',from,data:'lb:nav:abcdef123456',message:{message_id:1,chat:message.chat}}});assert.match(sent.find(c=>c.method==='sendMessage').body.text,/انتهت|متاحة/);
      } finally {globalThis.fetch=nativeFetch;}
    });
    await t.test('published Business callbacks enforce customer, chat, store, current rules, source visibility and publication revision',async()=>{
      const current=await request(bus);const configuration=structuredClone(current.data.published);
      const productsButton=configuration.screens[0].buttons.find((button:any)=>button.id==='products');
      productsButton.condition={field:'VIP_LEVEL',operator:'>=',value:2};
      configuration.screens.push({id:'vip',parentId:'home',title:'VIP screen',enabled:true,audience:'all',startsAt:null,endsAt:null,condition:{field:'VIP_LEVEL',operator:'>=',value:2},blocks:[],buttons:[{id:'vipproducts',title:'VIP products',action:'OPEN_PRODUCTS',target:null,enabled:true}]});
      const saved=await request(bus+'/draft',owner,{configuration,revision:current.data.revision});assert.equal(saved.status,200);
      assert.equal((await request(bus+'/publish',owner,{revision:saved.data.revision})).status,200);
      const nativeFetch=globalThis.fetch;const sent:any[]=[];
      globalThis.fetch=(async(input:any,options:any)=>{if(String(input).startsWith('https://api.telegram.org/')){sent.push({method:String(input).split('/').at(-1),body:JSON.parse(options.body)});return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200});}return nativeFetch(input,options);}) as typeof fetch;
      const bot={tokenHash:'qa-only',token:'qa-only',controller:new AbortController(),nextOffset:0};const from={id:951001,first_name:'QA customer'},chat={id:951001,type:'private'};let updateId=99100;
      const message=()=>sent.find(call=>call.method==='sendMessage')?.body;
      const start=async()=>{sent.length=0;await handleTelegramUpdate(business,bot,{update_id:++updateId,message:{chat,from,text:'/start'}});return message();};
      const callback=async(data:string,targetStore=business,who=from,where=chat)=>{sent.length=0;await handleTelegramUpdate(targetStore,bot,{update_id:++updateId,callback_query:{id:`scope-${updateId}`,from:who,data,message:{message_id:1,chat:where}}});return message();};
      const unavailable=(body:any)=>{assert.ok(body);assert.match(body.text,/انتهت|متاحة|غير متاح/);assert.ok(!JSON.stringify(body).includes('Owned product'));};
      try {
        const home=await start();const productCallback=home.reply_markup.inline_keyboard.flat().find((button:any)=>button.text===productsButton.title)?.callback_data;assert.match(productCallback,/^lb:nav:[a-f0-9]{12}$/);
        const catalog=await callback(productCallback);assert.match(catalog.text,/Owned product/);
        unavailable(await callback(productCallback,business,{id:951030,first_name:'Different customer'}));
        unavailable(await callback(productCallback,business,from,{id:951031,type:'private'}));
        unavailable(await callback(productCallback,free));
        await db.update(customersTable).set({vipLevel:0}).where(eq(customersTable.id,customerId));unavailable(await callback(productCallback));
        await db.update(customersTable).set({vipLevel:2}).where(eq(customersTable.id,customerId));
        const child=await callback('lb:screen:vip');const childCallback=child.reply_markup.inline_keyboard.flat().find((button:any)=>button.text==='VIP products')?.callback_data;assert.match(childCallback,/^lb:nav:[a-f0-9]{12}$/);
        await db.update(customersTable).set({vipLevel:0}).where(eq(customersTable.id,customerId));unavailable(await callback(childCallback));
        await db.update(customersTable).set({vipLevel:2}).where(eq(customersTable.id,customerId));
        const fresh=await start();const previous=fresh.reply_markup.inline_keyboard.flat().find((button:any)=>button.text===productsButton.title)?.callback_data;
        const latest=await request(bus);productsButton.enabled=false;
        const edited=await request(bus+'/draft',owner,{configuration,revision:latest.data.revision});assert.equal(edited.status,200);assert.equal((await request(bus+'/publish',owner,{revision:edited.data.revision})).status,200);
        unavailable(await callback(previous));const newHome=await start();assert.ok(!newHome.reply_markup.inline_keyboard.flat().some((button:any)=>button.text===productsButton.title));
        const groupOrders=await callback('lb:orders:1',business,from,{id:-951100,type:'group'});assert.ok(!JSON.stringify(groupOrders).includes(orderIds[0]));assert.ok(!JSON.stringify(groupOrders).includes(orderIds[1]));assert.match(groupOrders.text,/خاصة/);
      } finally {globalThis.fetch=nativeFetch;await db.update(customersTable).set({vipLevel:2}).where(eq(customersTable.id,customerId));}
    });
  } finally {
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await db.delete(growthJobsTable).where(inArray(growthJobsTable.storeId,stores));
    // All fixtures are contained in this disposable schema-only branch.
    await pool.query('delete from commerce_order_rewards where store_id=any($1)',[stores]);
    await db.delete(storesTable).where(inArray(storesTable.id,stores));
    await db.delete(usersTable).where(inArray(usersTable.id,[owner,other,staff,admin]));
    await pool.end();
  }
});
