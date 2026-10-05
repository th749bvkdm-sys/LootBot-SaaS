import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCategoryPresentation } from './category-presentation.ts';
test('category presentation persists a real emoji and secure image URL, with explicit clearing',()=>{
  assert.deepEqual(parseCategoryPresentation({emoji:'🎮',imageUrl:'https://example.com/category.jpg'}),{emoji:'🎮',imageUrl:'https://example.com/category.jpg'});
  assert.deepEqual(parseCategoryPresentation({emoji:' 📂 ',imageUrl:' '}),{emoji:'📂',imageUrl:null});
  assert.deepEqual(parseCategoryPresentation({emoji:'👨‍👩‍👧‍👦',imageUrl:null}),{emoji:'👨‍👩‍👧‍👦',imageUrl:null});
});
test('category presentation rejects script/credential URLs, nonemoji text and invalid types',()=>{
  for(const imageUrl of ['http://example.com/a.jpg','javascript:alert(1)','data:image/png;base64,a','https://user:secret@example.com/a.jpg','https://example.com/a\n.jpg','x'.repeat(1501),42,undefined])assert.equal(parseCategoryPresentation({emoji:'📂',imageUrl}),null,String(imageUrl));
  for(const emoji of ['','folder','<script>','📂'.repeat(9),'\u202e📂',null])assert.equal(parseCategoryPresentation({emoji,imageUrl:null}),null);
  assert.equal(parseCategoryPresentation([]),null);
});
