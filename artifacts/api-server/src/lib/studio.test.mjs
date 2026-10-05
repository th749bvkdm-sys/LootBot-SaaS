import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUSINESS_CONFIGURATION, parseBusinessConfiguration, renderBusinessScreen, validActionTarget } from './telegram-business-configuration.ts';
import { DEFAULT_HOME_CONFIGURATION, parseHomeConfiguration, renderConfiguredHome, HOME_LAYOUTS } from './telegram-home-configuration.ts';
import { parseScreenStyles, presentTelegramScreen, TELEGRAM_THEMES } from './telegram-presentation.ts';
import { PRODUCT_CARD_STYLES, productCardText } from './telegram-product-card.ts';
import { parseNavigationCallback } from './telegram-navigation.ts';
const viewer={storeName:'Store',customerName:'Ali',returning:false,now:Date.now(),available:{cart:false,coupons:true}};
test('Business allows validated links/messages/targets and rejects arbitrary callbacks or secrets in URLs',()=>{
  for(const [action,target] of [['OPEN_URL','javascript:alert(1)'],['OPEN_URL','https://key:secret@example.com'],['CUSTOM_CALLBACK','delete-store'],['OPEN_PRODUCT','not-a-uuid'],['SEND_MESSAGE','x'.repeat(501)]])assert.equal(validActionTarget(action,target),false);
  const config=structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  config.screens[0].buttons.push({id:'link',title:'Link',action:'OPEN_URL',target:'https://example.com/',enabled:true},{id:'message',title:'Message',action:'SEND_MESSAGE',target:'Hi {{customer}}',enabled:true},{id:'cart',title:'Cart',action:'OPEN_CART',target:null,enabled:true});
  const parsed=parseBusinessConfiguration(config);assert.ok(parsed);const buttons=renderBusinessScreen(parsed,'home',viewer).keyboard.flat();
  assert.ok(buttons.some(b=>b.url==='https://example.com/'));assert.ok(buttons.some(b=>b.callback_data==='lb:msg:home:message'));assert.ok(!buttons.some(b=>b.callback_data==='lb:commerce:cart'));
  assert.deepEqual(parseNavigationCallback('lb:msg:home:message'),{kind:'message',screenId:'home',buttonId:'message'});
  assert.equal(parseNavigationCallback('lb:msg:home:../../bad'),null);
});
test('conditional blocks/buttons fail closed and experiment variants change content only',()=>{
  const config=structuredClone(DEFAULT_BUSINESS_CONFIGURATION);config.experiment={id:'test',enabled:true,ratio:50};
  config.screens[0].blocks.push({id:'vip',type:'VIP_BLOCK',text:'Private VIP',enabled:true},{id:'variant',type:'TEXT',text:'Variant A',enabled:true,variant:'A'},{id:'points',type:'TEXT',text:'Points bonus',enabled:true,condition:{field:'POINTS_GREATER_THAN',operator:'>=',value:10}});
  config.screens[0].buttons[0].condition={field:'HAS_ORDERS',operator:'=',value:true};
  assert.ok(parseBusinessConfiguration(config));const generic=renderBusinessScreen(config,'home',viewer);assert.ok(!generic.text.includes('Private VIP'));assert.ok(!generic.text.includes('Points bonus'));assert.ok(!generic.text.includes('Variant A'));
  const facts={VIP_LEVEL:2,POINTS_GREATER_THAN:20,HAS_ORDERS:true};const actual=renderBusinessScreen(config,'home',{...viewer,facts,experimentVariant:'A'});
  assert.ok(actual.text.includes('Private VIP'));assert.ok(actual.text.includes('Points bonus'));assert.ok(actual.text.includes('Variant A'));assert.ok(actual.keyboard.flat().some(b=>b.callback_data==='lb:products:1'));
});
test('real Business data blocks render owned records and never invent absent products',()=>{
  const config=structuredClone(DEFAULT_BUSINESS_CONFIGURATION);config.screens[0].blocks=[{id:'featured',type:'FEATURED',text:'',enabled:true}];assert.ok(parseBusinessConfiguration(config));
  assert.ok(!renderBusinessScreen(config,'home',viewer).text.includes('Fake product'));
  const live=renderBusinessScreen(config,'home',{...viewer,data:{featured:{text:'Owned item · 12 USD',buttons:[{text:'Owned item',callback_data:'lb:product:123456789abc'}]}}});assert.match(live.text,/Owned item/);
});
test('all Pro layouts persist and change layout/navigation in both serialized preview and runtime',()=>{
  for(const layout of HOME_LAYOUTS){const c=parseHomeConfiguration({...DEFAULT_HOME_CONFIGURATION,layout,announcement:'Sale',productCardStyle:'premium'});assert.ok(c);assert.deepEqual(renderConfiguredHome(c,'S','A'),renderConfiguredHome(JSON.parse(JSON.stringify(c)),'S','A'));}
  assert.equal(renderConfiguredHome({...DEFAULT_HOME_CONFIGURATION,layout:'grid-3'},'S','A').keyboard[0].length,3);
  assert.equal(renderConfiguredHome({...DEFAULT_HOME_CONFIGURATION,layout:'vertical'},'S','A').keyboard[0].length,1);
  assert.equal(renderConfiguredHome({...DEFAULT_HOME_CONFIGURATION,layout:'offers-first'},'S','A').keyboard[0][0].callback_data,'lb:offers:1');
  assert.equal(parseHomeConfiguration({...DEFAULT_HOME_CONFIGURATION,productCardStyle:'execute-script'}),null);
});
test('all themes and state styles apply presentation while preserving safe controls',()=>{
  const keyboard=[[{text:'🛍 One',callback_data:'lb:products:1'},{text:'Two',url:'https://example.com'}],[{text:'رجوع',callback_data:'lb:home'}]];
  for(const theme of TELEGRAM_THEMES){const result=presentTelegramScreen(theme,{title:'{{store}}',subtitle:'{{customer}}',footer:'Thanks',columns:1,showEmoji:false,bannerUrl:''},'Products\nReal data',keyboard,'Store','Ali');assert.match(result.text,/Store/);assert.match(result.text,/Ali/);assert.ok(result.keyboard.flat().some(b=>b.url==='https://example.com'));assert.ok(result.keyboard.flat().some(b=>b.callback_data==='lb:home'));}
  assert.equal(parseScreenStyles({product:{title:'x',subtitle:'',footer:'',columns:1,showEmoji:true,bannerUrl:'https://key:secret@images.example/'}}),null);
});
test('product cards display real metadata and never manufacture ratings or discounts',()=>{
  const product={name:'Item',price:'10',oldPrice:'20',stock:3,sku:'SKU',warranty:'1 year',tags:['Game'],description:'Actual description'};
  for(const style of PRODUCT_CARD_STYLES){const result=productCardText(product,'USD',style);assert.match(result,/10.00 USD/);assert.ok(!result.includes('5 / 5'));}
  assert.match(productCardText(product,'USD','sale'),/50%/);assert.ok(productCardText(product,'USD','warranty-first').startsWith('الضمان'));assert.ok(productCardText(product,'USD','price-first').startsWith('10.00'));
});
test('screen blocks and buttons cannot alias one message callback',()=>{
  const config=structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  config.screens[0].blocks.push({id:'products',type:'CUSTOM_BUTTON',text:'Visible',action:'SEND_MESSAGE',target:'Visible text',enabled:true});
  assert.equal(parseBusinessConfiguration(config),null);
});
