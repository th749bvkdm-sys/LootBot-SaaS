import assert from 'node:assert/strict';
import test from 'node:test';
import { businessBlockStyles, businessBlockText, businessBlockTitle } from './telegram-business-block-presentation.ts';
import { DEFAULT_BUSINESS_CONFIGURATION, parseBusinessConfiguration, renderBusinessScreen } from './telegram-business-configuration.ts';

test('plain Business blocks retain saved title/body and apply only meaningful family styles', () => {
  const block = { type: 'TEXT', title: '📌 Actual title', text: 'Actual first line\nActual second line' };
  const outputs = businessBlockStyles('TEXT').map(style => businessBlockText({ ...block, style }));
  assert.equal(new Set(outputs).size, outputs.length);
  for (const output of outputs) { assert.match(output, /Actual title/); assert.match(output, /Actual first line/); assert.match(output, /Actual second line/); assert.doesNotMatch(output, /خصم|ضمان|السعر/); }
  assert.deepEqual(businessBlockStyles('PRODUCT'), ['classic','compact','premium','sale','minimal','image-first','price-first','warranty-first','VIP']);
  assert.ok(!businessBlockStyles('FAQ').includes('price-first'));
  assert.ok(!businessBlockStyles('BANNER').includes('warranty-first'));
});

test('titles, text decorations, separators and spacers change real preview/runtime output safely', () => {
  const config = structuredClone(DEFAULT_BUSINESS_CONFIGURATION);
  config.screens[0].blocks = [
    { id:'title', type:'HEADER', title:'Actual heading', text:'Actual header text', enabled:true, style:'premium' },
    { id:'faq', type:'FAQ', title:'Actual question', text:'Actual answer', enabled:true },
    { id:'banner', type:'BANNER', title:'Actual banner', text:'Actual caption', target:'https://images.example/real.jpg', enabled:true, style:'compact' },
    { id:'divider', type:'DIVIDER', text:'', enabled:true, style:'premium' },
    { id:'spacer', type:'SPACER', text:'', enabled:true, style:'compact' },
    { id:'link', type:'EXTERNAL_LINK', title:'Actual website', text:'', target:'https://example.com', enabled:true, style:'VIP' },
  ];
  assert.ok(parseBusinessConfiguration(config));
  const viewer={storeName:'Actual store',customerName:'Actual customer',returning:false,now:Date.now()};
  const preview=renderBusinessScreen(config,'home',viewer);
  assert.match(preview.text,/✦ Actual heading/);assert.match(preview.text,/Actual header text/);
  assert.match(preview.text,/❓ Actual question\nActual answer/);
  assert.match(preview.text,/Actual banner · Actual caption/);
  assert.match(preview.text,/──── ✦ ────/);
  assert.deepEqual(preview.images,['https://images.example/real.jpg']);
  assert.ok(preview.keyboard.flat().some(button=>button.text==='♛ Actual website'&&button.url==='https://example.com'));
  assert.deepEqual(preview,renderBusinessScreen(JSON.parse(JSON.stringify(config)),'home',viewer));
  config.screens[0].blocks[0].text='x'.repeat(500);
  for(let i=0;i<5;i++)config.screens[0].blocks.push({id:'long'+i,type:'TEXT',title:'A'.repeat(80),text:'x'.repeat(500),enabled:true,style:'premium'});
  assert.ok(renderBusinessScreen(config,'home',viewer).text.length<=3800);
});

test('block menu labels preserve safe actions while applying actual decoration', () => {
  assert.equal(businessBlockTitle('  Actual\n name ', 'compact'),'Actual name');
  assert.equal(businessBlockTitle('🎮 Actual name','minimal'),'Actual name');
  assert.equal(new Set(businessBlockStyles('DIVIDER').map(style=>businessBlockText({type:'DIVIDER',text:'',style}))).size,4);
  assert.notEqual(businessBlockText({type:'SPACER',text:'',style:'classic'}),businessBlockText({type:'SPACER',text:'',style:'compact'}));
});
