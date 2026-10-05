// Disposable browser acceptance fixture. Never runs against a production host.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { eq,inArray } from 'drizzle-orm';
import app from '../src/app';
import {db,pool,usersTable,storesTable,storeSettingsTable,categoriesTable,productsTable,customersTable,ordersTable,growthJobsTable} from '@workspace/db';
import {passwordHash} from '../src/lib/security';
import {DEFAULT_HOME_CONFIGURATION} from '../src/lib/telegram-home-configuration';
import {DEFAULT_BUSINESS_CONFIGURATION} from '../src/lib/telegram-business-configuration';
if(new URL(process.env.DATABASE_URL!).hostname!=='ep-summer-recipe-b21ls93d-pooler.c-6.eu-central-1.aws.neon.tech')throw Error('Only isolated V2 acceptance DB is allowed.');
for(const name of ['0003_growth_execution.sql','0004_product_presentation.sql','0005_customer_commerce.sql','0006_store_team.sql','0007_category_presentation.sql'])await pool.query(await readFile(`../../lib/db/migrations/${name}`,'utf8'));
const owner=randomUUID(),store=randomUUID(),category=randomUUID(),customer=randomUUID();
await db.insert(usersTable).values({id:owner,name:'اختبار النسخة الجديدة',email:`ui-${owner}@example.invalid`,passwordHash:await passwordHash('V2-Only-Isolated-Preview-2026!'),role:'SUPERADMIN'});
await db.insert(storesTable).values({id:store,ownerId:owner,name:'متجر اختبار V2',slug:'ui-'+store,currency:'SAR'});
await db.insert(storeSettingsTable).values({storeId:store,pointsEnabled:true,referralsEnabled:true,couponsEnabled:true,reviewsEnabled:true,supportEnabled:true,settings:{plan:{code:'BUSINESS'},cartEnabled:true,favoritesEnabled:true,supportUsername:'lootbot_test',telegramHomeStudio:{draft:DEFAULT_HOME_CONFIGURATION,published:null,revision:0},telegramBusinessStudio:{draft:DEFAULT_BUSINESS_CONFIGURATION,published:null,revision:0}}});
await db.insert(categoriesTable).values({id:category,storeId:store,name:'ألعاب اختبار',emoji:'🎮'});
await db.insert(productsTable).values({id:randomUUID(),storeId:store,categoryId:category,name:'منتج اختبار',description:'هذا سجل اختبار معزول للفحص فقط.',price:'75.00',oldPrice:'100.00',stock:10,isPublished:true,featured:true,warranty:'سنة',sku:'UI-V2'});
await db.insert(customersTable).values({id:customer,storeId:store,telegramUserId:'99951001',telegramChatId:'99951001',name:'عميل الاختبار',vipLevel:1});
await db.insert(ordersTable).values({id:randomUUID(),storeId:store,telegramUserId:'99951001',telegramChatId:'99951001',customerName:'عميل الاختبار',total:'75',currency:'SAR'});
const server=app.listen(5190,'127.0.0.1',()=>console.log(`UI_ACCEPTANCE_READY email=ui-${owner}@example.invalid store=${store}`));
let closing=false;
async function close(){if(closing)return;closing=true;server.close();await db.delete(growthJobsTable).where(eq(growthJobsTable.storeId,store));await db.delete(storesTable).where(eq(storesTable.id,store));await db.delete(usersTable).where(eq(usersTable.id,owner));await pool.end();process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
