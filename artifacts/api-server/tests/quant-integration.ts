/** Real HTTP tests against a disposable PostgreSQL schema. All questions are original test fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import app from '../src/app';
import {pool,db,usersTable,sessionsTable} from '@workspace/db';
import {sha256} from '../src/lib/security';
import {normalizeForDedup,validateQuestion,assertSourceCanBeImported,normalizedQuestionHash} from '../src/lib/quant-content';
import {expireQuantAttempts} from '../src/lib/quant';
// Only this disposable schema simulates the registered publisher's file identity.
// The question stems, answers and licenses below remain original synthetic QA fixtures;
// no PDF is opened or publisher content copied by these HTTP tests.
const simulatedMufakirSourceHash='3d7c9c2034b8e326d7242b0ffea44e08b58d7f5b40db765a4697f3adeea35c2b';

test('quantitative source gate and normalization do not infer permissions from a free filename',()=>{
 for(const licenseStatus of ['unverified','restricted','rejected']) assert.throws(()=>assertSourceCanBeImported({licenseStatus,licenseNote:'الاسم يحتوي على كلمة مجاني'}));
 assert.throws(()=>assertSourceCanBeImported({licenseStatus:'verified',licenseNote:''}));
 assert.doesNotThrow(()=>assertSourceCanBeImported({licenseStatus:'verified',licenseNote:'إذن صريح موثق للمصدر الأصلي'}));
 assert.equal(normalizeForDedup('  أَوجد   ٢٠٪  من ١٠٠  '),normalizeForDedup('اوجد 20٪ من 100'));
 assert.equal(normalizedQuestionHash('أَوجد ١٠'),normalizedQuestionHash('اوجد 10'));
 assert.ok(validateQuestion({choices:[{key:'A',text:'1'},{key:'A',text:'2'}],correctKey:'A'}).includes('DUPLICATE_KEYS'));
 assert.ok(validateQuestion({choices:[{key:'A',text:'1'},{key:'B',text:'2'}],correctKey:'C'}).includes('CORRECT_KEY_NOT_IN_CHOICES'));
 assert.ok(validateQuestion({choices:[{key:'A',text:'١'},{key:'B',text:'1'}],correctKey:'A'}).includes('DUPLICATE_CHOICE_TEXT'));
});

test('quantitative exams: versioned content, deadlines, private drafts and actual analytics',async t=>{
 assert.match(process.env.TEACHER_TEST_SCHEMA||'',/^teacher_qa_/);
 const [admin,writer,teacher,student,otherStudent,unjoined]=Array.from({length:6},()=>randomUUID());
 const auth=new Map<string,{cookie:string;csrf:string}>();
 for(const [i,uid] of [admin,writer,teacher,student,otherStudent,unjoined].entries()){
  const token=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();
  await db.insert(usersTable).values({id:uid,name:'حساب اختبار كمي '+i,email:uid+'@example.invalid',passwordHash:'unused',role:i===0?'SUPERADMIN':'OWNER',accountType:i===2?'teacher':i>=3?'student':'merchant'});
  await db.insert(sessionsTable).values({id:randomUUID(),userId:uid,tokenHash:sha256(token),csrfHash:sha256(csrf),expiresAt:new Date(Date.now()+3600000)});
  auth.set(uid,{cookie:`lootbot_session=${token}; lootbot_csrf=${csrf}`,csrf});
 }
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const port=(server.address() as any).port;
 const request=async(path:string,uid=admin,body?:unknown,method=body===undefined?'GET':'POST',withCsrf=true)=>{
  const a=auth.get(uid)!;
  const r=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{cookie:a.cookie,'content-type':'application/json',...(withCsrf?{'x-csrf-token':a.csrf}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  let data:any;try{data=await r.json();}catch{data={};}return{status:r.status,data};
 };
 let school='',classId='',category='',source='',authoredSource='',testId='',attempt='',versions:string[]=[],questions:string[]=[];
 const makeQuestion=(stem:string,correct:string,wrong:string[])=>({stem,choices:[correct,...wrong].map((text,i)=>({key:String.fromCharCode(65+i),text})),correctKey:'A',explanation:'شرح أصلي للمعاينة المحلية: الحساب المباشر يعطي الاختيار الأول.',categoryId:category,difficulty:'easy',reviewStatus:'draft',sourceId:authoredSource||null,sourcePage:authoredSource?1:null,images:[]});
 try{
 await t.test('student membership and permission boundaries are enforced by the server',async()=>{
  school=(await request('/education/schools',admin,{name:'مدرسة الاختبار الكمي الأصلية'})).data.id;
  await request('/education/grants',admin,{userId:teacher,role:'TEACHER',scope:school});
  await request('/education/grants',admin,{userId:writer,role:'CONTENT_MANAGER',scope:''});
  // Explicit permissions are local fixtures only; new quant privileges are never granted by account type.
  await pool.query(`UPDATE education_roles SET permissions=permissions||$1::jsonb WHERE role='CONTENT_MANAGER'`,[JSON.stringify(['quant.questions.write'])]);
  classId=(await request('/education/classes',admin,{schoolId:school,ownerId:teacher,name:'فصل اختبار كمي',grade:'الثالث',stage:'ثانوي'})).data.id;
  assert.ok(school);assert.ok(classId);
  for(const uid of [student,otherStudent]){
   const code=await request('/education/codes',admin,{schoolId:school,classId,maxUses:1,expiresAt:new Date(Date.now()+86400000).toISOString()});
   assert.equal((await request('/education/join',uid,{code:code.data.code})).status,200);
  }
  category=(await request('/education/categories',admin,{name:'مهارة اختبار كمي أصلية',track:'quantitative'})).data.id;
  assert.ok(category);
  assert.equal((await request('/quant/meta',unjoined)).status,403);
  assert.equal((await request('/quant/admin/sources',student)).status,403);
  assert.equal((await request('/quant/admin/tests',student,{title:'غير مصرح'})).status,403);
  assert.equal((await request('/quant/admin/sources',admin,{title:'طلب بلا CSRF',fileHash:'a'.repeat(64),fileSize:1,fileName:'local.pdf'},'POST',false)).status,403);
 });
 await t.test('unverified PDF metadata cannot be extracted or licensed by a student',async()=>{
  const registered=await request('/quant/admin/sources',admin,{title:'مصدر محلي غير مفعل لا يحتوي على أسئلة مستوردة',fileHash:'a'.repeat(64),fileSize:123,fileName:'unverified-local.pdf',sourceUrl:'',attribution:'metadata only'});
  assert.equal(registered.status,201);source=registered.data.id;assert.ok(source);
  const extraction=await request('/quant/admin/sources/'+source+'/extraction',admin,{});assert.equal(extraction.status,409);
  assert.equal((await request('/quant/admin/questions',admin,{...makeQuestion('سؤال لا يجوز إدخاله من مصدر غير مفعل','1',['2','3','4']),sourceId:source,sourcePage:1})).status,409);
  const report=await request('/quant/admin/sources/'+source+'/report',admin);assert.equal(report.status,200);assert.equal(report.data.pagesProcessed,0);assert.equal(report.data.questionsDiscovered,0);assert.equal(report.data.questionsApproved,0);
  assert.equal((await request('/quant/admin/sources/'+source+'/license',student,{licenseStatus:'verified',licenseNote:'تأليف الطالب'},'PATCH')).status,403);
  assert.equal((await request('/quant/admin/sources/'+source+'/license',admin,{licenseStatus:'verified',licenseNote:''},'PATCH')).status,400);
  const duplicate=await request('/quant/admin/sources',admin,{title:'نفس الملف',fileHash:'a'.repeat(64),fileSize:123,fileName:'duplicate.pdf'});assert.equal(duplicate.status,200);assert.equal(duplicate.data.id,source);assert.equal(duplicate.data.duplicate,true);
  const authored=await request('/quant/admin/sources',admin,{title:'تأليف اختبار محلي أصلي • يحاكي هوية مصدر المفكر للاختبار فقط',fileHash:simulatedMufakirSourceHash,fileSize:0,fileName:'quant-integration.ts',sourceUrl:'',attribution:'مسائل أصلية في اختبار المشروع، غير مقتبسة من ملفات PDF. بصمة مصدر المفكر محاكاة في قاعدة اختبار مؤقتة فقط.'});assert.equal(authored.status,201,JSON.stringify(authored.data));authoredSource=authored.data.id;
  assert.equal((await request('/quant/admin/sources/'+authoredSource+'/license',admin,{licenseStatus:'verified',licenseNote:'المصدر هو المسائل الأصلية المؤلفة في quant-integration.ts، ومصرح بإعادة استخدامها داخل هذا الاختبار المحلي فقط.'},'PATCH')).status,200);
 });
 await t.test('question validation, review and immutable versions exclude unapproved content',async()=>{
  const malformed=makeQuestion('سؤال اختبار غير صالح','1',['2','3','4']);malformed.choices[1].key='A';
  assert.equal((await request('/quant/admin/questions',admin,malformed)).status,400);
  assert.equal((await request('/quant/admin/questions',admin,{...makeQuestion('المفتاح الصحيح غير موجود','1',['2','3','4']),correctKey:'Z'})).status,400);
  assert.equal((await request('/quant/admin/questions',admin,{...makeQuestion('خيارات متكررة','1',['1','3','4'])})).status,400);
  for(const [stem,correct,wrong] of [
   ['ما قيمة 25٪ من 240؟','60',['50','80','100']],
   ['إذا كان 3س = 21، فما قيمة س؟','7',['6','8','9']],
   ['مربع طول ضلعه 5 وحدات، فما مساحته؟','25',['10','20','30']],
  ] as [string,string,string[]][]){
   const created=await request('/quant/admin/questions',writer,makeQuestion(stem,correct,wrong));assert.equal(created.status,201);questions.push(created.data.id);versions.push(created.data.versionId);
  }
  assert.ok(versions.every(Boolean));
 });
 const config={title:'اختبار كمي أصلي محلي',description:'ثلاث مسائل ألفت للاختبار المحلي فقط.',mode:'timed',timeLimitSec:180,allowReturn:true,revealPolicy:'after_submit',revealAt:null,status:'draft',schoolId:school,classId,stage:'',versionIds:versions};
 await t.test('publication requires reviewed versions and frozen test items',async()=>{
  const drafted=await request('/quant/admin/tests',admin,config);assert.equal(drafted.status,201);testId=drafted.data.id;assert.ok(testId);
  assert.equal((await request('/quant/admin/tests/'+testId,admin,{...config,status:'published'},'PUT')).status,409);
  assert.equal((await request('/quant/admin/versions/'+versions[0]+'/review',writer,{reviewStatus:'reviewed',reviewNote:'طلب غير مصرح'},'PATCH')).status,403);
  for(const vid of versions){
   assert.equal((await request('/quant/admin/versions/'+vid+'/review',admin,{reviewStatus:'approved',reviewNote:'طلب اعتماد قبل المراجعة'},'PATCH')).status,409);
   assert.equal((await request('/quant/admin/versions/'+vid+'/review',admin,{reviewStatus:'reviewed',reviewNote:'راجع المسؤول الحساب والخيارات الأصلية.'},'PATCH')).status,200);
   assert.equal((await request('/quant/admin/versions/'+vid+'/review',admin,{reviewStatus:'approved',reviewNote:'اعتماد بعد مراجعة الحساب والخيارات الأصلية.'},'PATCH')).status,200);
  }
  assert.equal((await request('/quant/admin/tests/'+testId,admin,{...config,status:'published'},'PUT')).status,200);
  const listed=await request('/quant/tests',student);assert.equal(listed.status,200);assert.ok(listed.data.some((x:any)=>x.id===testId));
  const foreignSchool=(await request('/education/schools',admin,{name:'مدرسة خارج نطاق الطالب'})).data.id;
  const foreign=await request('/quant/admin/tests',admin,{...config,title:'اختبار مدرسة أخرى',status:'published',schoolId:foreignSchool,classId:null});assert.equal(foreign.status,201);
  assert.equal((await request('/quant/tests/'+foreign.data.id+'/attempts',student,{})).status,404);
  assert.ok(!(await request('/quant/tests',student)).data.some((x:any)=>x.id===foreign.data.id));
 });
 await t.test('student catalog uses source identity, numeric section order and only publisher practice while retaining old history',async()=>{
  const originalCategory=(await request('/education/categories',admin,{name:'أسئلة أصلية خارج فهرس المفكر',track:'quantitative'})).data.id;
  const originalSource=(await request('/quant/admin/sources',admin,{title:'مصدر أصلي مستقل لا ينتمي للمفكر',fileHash:sha256('non-mufakir licensed QA source'),fileSize:0,fileName:'original-negative-fixture.ts',attribution:'تأليف اختبار أصلي مستقل.'})).data.id;
  assert.equal((await request('/quant/admin/sources/'+originalSource+'/license',admin,{licenseStatus:'verified',licenseNote:'مسألة أصلية مصرح بها للاختبار المحلي؛ لا تنتمي إلى المفكر.'},'PATCH')).status,200);
  const originalBody={...makeQuestion('مسألة أصلية خارج المفكر: ما ناتج 8 + 2؟','10',['9','11','12']),categoryId:originalCategory,sourceId:originalSource,sourcePage:1};
  const originalQuestion=await request('/quant/admin/questions',writer,originalBody);assert.equal(originalQuestion.status,201);
  for(const reviewStatus of ['reviewed','approved']) assert.equal((await request('/quant/admin/versions/'+originalQuestion.data.versionId+'/review',admin,{reviewStatus,reviewNote:'مراجعة المسألة الأصلية الحسابية للاختبار المحلي فقط.'},'PATCH')).status,200);
  const misleading=await request('/quant/admin/tests',admin,{...config,title:'القسم 3 • المفكر',status:'published',versionIds:[originalQuestion.data.versionId]});assert.equal(misleading.status,201);
  const mixed=await request('/quant/admin/tests',admin,{...config,title:'القسم 4',status:'published',versionIds:[versions[0],originalQuestion.data.versionId]});assert.equal(mixed.status,201);
  const sectionIds:string[]=[];
  for(const number of [10,2,1]) { const section=await request('/quant/admin/tests',admin,{...config,title:'القسم '+number,status:'published'});assert.equal(section.status,201);sectionIds.push(section.data.id); }
  const listed=await request('/quant/tests',student);assert.equal(listed.status,200);
  assert.ok(!listed.data.some((row:any)=>[misleading.data.id,mixed.data.id].includes(row.id)));
  assert.deepEqual(listed.data.filter((row:any)=>sectionIds.includes(row.id)).map((row:any)=>row.title),['القسم 1','القسم 2','القسم 10']);
  assert.equal((await request('/quant/tests/'+misleading.data.id+'/attempts',student,{})).status,404);
  assert.equal((await request('/quant/tests/'+mixed.data.id+'/attempts',student,{})).status,404);
  const meta=await request('/quant/meta',student);assert.equal(meta.status,200);assert.ok(!meta.data.skills.some((row:any)=>row.id===originalCategory));
  assert.equal(meta.data.skills.find((row:any)=>row.id===category)?.questionCount,3);
  assert.equal((await request('/quant/practice',student,{categoryId:originalCategory,count:5})).status,409);
  const practice=await request('/quant/practice',student,{count:50});assert.equal(practice.status,201);
  const practiceState=await request('/quant/attempts/'+practice.data.attemptId,student);assert.equal(practiceState.status,200);assert.equal(practiceState.data.items.length,3);
  assert.ok(practiceState.data.items.every((row:any)=>versions.includes(row.versionId)));
  assert.equal((await request('/quant/attempts/'+practice.data.attemptId+'/submit',student,{})).status,200);
  // Simulate a completed attempt saved before the catalog restriction, preserving its immutable snapshot.
  const enrollment=(await pool.query("SELECT id FROM education_enrollments WHERE user_id=$1 AND status='active'",[student])).rows[0].id;
  const oldAttempt=randomUUID(), oldItem={versionId:originalQuestion.data.versionId,questionId:originalQuestion.data.id,position:0,stem:originalBody.stem,choices:originalBody.choices,correctKey:'A',explanation:originalBody.explanation,images:[],categoryId:originalCategory,skill:'أسئلة أصلية خارج فهرس المفكر',difficulty:'easy',sourceId:originalSource,sourcePage:1};
  await pool.query(`INSERT INTO quant_attempts(id,test_id,user_id,enrollment_id,school_id,class_id,test_snapshot,snapshot,status,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'submitted',now())`,[oldAttempt,misleading.data.id,student,enrollment,school,classId,JSON.stringify({title:'محاولة أصلية قديمة',mode:'untimed',allowReturn:true,revealPolicy:'after_submit'}),JSON.stringify([oldItem])]);
  await pool.query("INSERT INTO quant_responses(attempt_id,version_id,choice_key,visited) VALUES($1,$2,'B',true)",[oldAttempt,originalQuestion.data.versionId]);
  const history=await request('/quant/history',student);assert.equal(history.status,200);assert.ok(history.data.some((row:any)=>row.id===oldAttempt));
  const oldResult=await request('/quant/attempts/'+oldAttempt+'/result',student);assert.equal(oldResult.status,200);assert.equal(oldResult.data.summary.wrong,1);assert.equal(oldResult.data.items[0].correctKey,'A');
  assert.equal(oldResult.data.items[0].explanationAvailable,false);assert.equal(oldResult.data.items[0].explanation,undefined);
  assert.equal((await request('/quant/attempts/'+oldAttempt+'/result',otherStudent)).status,404);
 });
 await t.test('attempt deadlines come from the server and active payloads contain no solutions',async()=>{
  const started=await request('/quant/tests/'+testId+'/attempts',student,{});assert.equal(started.status,201);attempt=started.data.id||started.data.attemptId||started.data.attempt?.id;assert.ok(attempt);
  const state=await request('/quant/attempts/'+attempt,student);assert.equal(state.status,200);assert.equal(state.data.items.length,3);
  assert.equal(new Date(state.data.attempt.deadlineAt).getTime()-new Date(state.data.attempt.startedAt).getTime(),180000);
  assert.equal(state.data.attempt.status,'in_progress');assert.ok(state.data.serverTime);
  assert.ok(!/correctKey|explanation|"answer"/.test(JSON.stringify(state.data)));
  const hiddenResult=await request('/quant/attempts/'+attempt+'/result',student);assert.ok(!/correctKey|explanation|"answer"/.test(JSON.stringify(hiddenResult.data)));
  assert.equal((await request('/quant/attempts/'+attempt,otherStudent)).status,404);
  assert.equal((await request('/quant/attempts/'+randomUUID(),otherStudent)).status,404);
  assert.equal((await request('/quant/attempts/'+attempt+'/answers/'+randomUUID(),student,{choiceKey:'A',flagged:false,revision:0},'PUT')).status,404);
  assert.equal((await request('/quant/attempts/'+attempt+'/answers/'+versions[0],student,{choiceKey:'Z',flagged:false,revision:0},'PUT')).status,400);
 });
 await t.test('answers can change or clear with revisions; navigation and review state persist',async()=>{
  const path='/quant/attempts/'+attempt+'/answers/'+versions[0];
  const first=await request(path,student,{choiceKey:'B',flagged:true,revision:0},'PUT');assert.equal(first.status,200);assert.equal(first.data.response.choiceKey,'B');
  const second=await request(path,student,{choiceKey:'A',flagged:true,revision:1},'PUT');assert.equal(second.status,200);assert.equal(second.data.response.changeCount,1);
  const conflict=await request(path,student,{choiceKey:'C',flagged:false,revision:0},'PUT');assert.equal(conflict.status,409);
  const cleared=await request(path,student,{choiceKey:null,flagged:false,revision:2},'PUT');assert.equal(cleared.status,200);assert.equal(cleared.data.response.choiceKey,null);
  assert.equal((await request(path,student,{choiceKey:'A',flagged:false,revision:3},'PUT')).status,200);
  assert.equal((await request('/quant/attempts/'+attempt+'/navigate',student,{position:1})).status,200);
  assert.equal((await request('/quant/attempts/'+attempt+'/answers/'+versions[1],student,{choiceKey:'B',flagged:true,revision:0},'PUT')).status,200);
  assert.equal((await request('/quant/attempts/'+attempt+'/navigate',student,{position:0})).status,200);
  const restored=await request('/quant/attempts/'+attempt,student);const r=restored.data.responses.find((x:any)=>x.questionVersionId===versions[0]);
  assert.equal(r.choiceKey,'A');assert.equal(r.flagged,false);assert.equal(r.changeCount,3);assert.ok(r.timeSpentMs>=0);
  assert.equal(restored.data.attempt.currentIndex,0);
 });
 await t.test('per-question strokes restore privately and stale revisions cannot overwrite them',async()=>{
  const strokes=[{color:'#9b7cff',width:3,points:[[12,23,0.5],[25,33,0.8]]}];
  const path='/quant/attempts/'+attempt+'/scratchpad/'+versions[0];
  const saved=await request(path,student,{strokes,revision:0},'PUT');assert.equal(saved.status,200);assert.equal(saved.data.revision,1);
  const restored=await request(path,student);assert.equal(restored.status,200);assert.deepEqual(restored.data.strokes,strokes);assert.equal(restored.data.revision,1);
  assert.equal((await request(path,otherStudent)).status,404);
  assert.ok([403,404].includes((await request(path,teacher)).status));
  assert.ok([403,404].includes((await request(path,admin)).status));
  assert.equal((await request(path,student,{strokes:[],revision:0},'PUT')).status,409);
  const stillSaved=await request(path,student);assert.deepEqual(stillSaved.data.strokes,strokes);
  assert.equal((await request(path,student,{strokes:[{color:'#ffffff',width:3,points:[[1,2,2]]}],revision:1},'PUT')).status,400);
  const crowded=Array.from({length:4},()=>({color:'#9b7cff',width:3,points:Array.from({length:3001},(_,i)=>[i/10,i/20,0.5])}));
  assert.equal((await request(path,student,{strokes:crowded,revision:1},'PUT')).status,400);
  assert.equal((await request('/quant/attempts/'+attempt+'/scratchpad/'+randomUUID(),student,{strokes:[],revision:0},'PUT')).status,404);
 });
 await t.test('editing a bank question leaves a started attempt pinned to its original version',async()=>{
  const changed=await request('/quant/admin/questions/'+questions[0],admin,makeQuestion('نص سؤال معدل بعد بدء المحاولة الأصلية.','120',['60','80','100']),'PATCH');assert.equal(changed.status,200);
  assert.notEqual(changed.data.versionId,versions[0]);
  const current=await request('/quant/attempts/'+attempt,student);assert.equal(current.data.items[0].stem,'ما قيمة 25٪ من 240؟');assert.equal(current.data.items[0].versionId,versions[0]);
 });
 await t.test('server grading separates correct, wrong and unanswered; repeated submission is idempotent',async()=>{
  const submitted=await request('/quant/attempts/'+attempt+'/submit',student,{});assert.equal(submitted.status,200);
  const first=await request('/quant/attempts/'+attempt+'/result',student);assert.equal(first.status,200);assert.equal(first.data.revealed,true);
  assert.equal(first.data.summary.correct,1);assert.equal(first.data.summary.wrong,1);assert.equal(first.data.summary.unanswered,1);
  assert.equal(first.data.summary.accuracy,0.5);assert.equal(first.data.summary.completion,2/3);
  assert.ok(first.data.items.some((q:any)=>q.correctKey));
  const again=await request('/quant/attempts/'+attempt+'/submit',student,{});assert.equal(again.status,200);
  const second=await request('/quant/attempts/'+attempt+'/result',student);assert.deepEqual(second.data.summary,first.data.summary);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM quant_attempts WHERE id=$1',[attempt])).rows[0].n,1);
  assert.equal((await request('/quant/attempts/'+attempt+'/answers/'+versions[2],student,{choiceKey:'A',flagged:false,revision:0},'PUT')).status,409);
 });
 await t.test('expired attempts close and grade on the server without a client submit',async()=>{
  const started=await request('/quant/tests/'+testId+'/attempts',student,{});assert.equal(started.status,201);const id=started.data.id||started.data.attemptId||started.data.attempt?.id;
  await pool.query("UPDATE quant_attempts SET deadline_at=now()-interval '1 second' WHERE id=$1",[id]);
  const late=await request('/quant/attempts/'+id+'/answers/'+versions[0],student,{choiceKey:'A',flagged:false,revision:0},'PUT');assert.equal(late.status,409);
  assert.equal(late.data.code,'TIME_EXPIRED');
  assert.equal((await pool.query('SELECT status FROM quant_attempts WHERE id=$1',[id])).rows[0].status,'expired');
  const state=await request('/quant/attempts/'+id,student);assert.equal(state.data.attempt.status,'expired');
  const result=await request('/quant/attempts/'+id+'/result',student);assert.equal(result.data.summary.unanswered,3);
  const silent=await request('/quant/tests/'+testId+'/attempts',otherStudent,{});assert.equal(silent.status,201);const silentId=silent.data.attemptId;
  await pool.query("UPDATE quant_attempts SET deadline_at=now()-interval '1 second' WHERE id=$1",[silentId]);
  assert.ok((await expireQuantAttempts())>=1);
  const row=(await pool.query('SELECT status,submitted_at FROM quant_attempts WHERE id=$1',[silentId])).rows[0];assert.equal(row.status,'expired');assert.ok(row.submitted_at);
 });
 await t.test('return restrictions and reveal policies are enforced independently of the browser',async()=>{
  const restricted=await request('/quant/admin/tests',admin,{...config,title:'اختبار بلا رجوع',status:'published',allowReturn:false});assert.equal(restricted.status,201);
  const beginning=await request('/quant/tests/'+restricted.data.id+'/attempts',student,{});assert.equal(beginning.status,201);const noReturnId=beginning.data.attemptId;
  assert.equal((await request('/quant/attempts/'+noReturnId+'/navigate',student,{position:1})).status,200);
  assert.equal((await request('/quant/attempts/'+noReturnId+'/navigate',student,{position:0})).status,409);
  assert.equal((await request('/quant/attempts/'+noReturnId+'/answers/'+versions[0],student,{choiceKey:'A',flagged:false,revision:0},'PUT')).status,409);
  for(const policy of ['never','after_each','after_deadline']){
   const published=await request('/quant/admin/tests',admin,{...config,title:'سياسة عرض '+policy,status:'published',revealPolicy:policy,revealAt:policy==='after_deadline'?new Date(Date.now()+3600000).toISOString():null});assert.equal(published.status,201);
   const started=await request('/quant/tests/'+published.data.id+'/attempts',student,{});assert.equal(started.status,201);const id=started.data.attemptId;
   assert.equal((await request('/quant/attempts/'+id+'/answers/'+versions[0],student,{choiceKey:'B',flagged:false,revision:0},'PUT')).status,200);
   const active=await request('/quant/attempts/'+id,student);assert.ok(!JSON.stringify(active.data).includes('correctKey'));
   if(policy==='after_each'){
    const feedback=await request('/quant/attempts/'+id+'/result',student);assert.equal(feedback.status,200);assert.equal(feedback.data.items.length,1);assert.equal(feedback.data.items[0].versionId,versions[0]);assert.equal(feedback.data.items[0].correctKey,'A');
   }
   await request('/quant/attempts/'+id+'/submit',student,{});
   const result=await request('/quant/attempts/'+id+'/result',student);assert.equal(result.status,200);
   if(policy!=='after_each'){assert.equal(result.data.revealed,false);assert.ok(!JSON.stringify(result.data).includes('correctKey'));}
   if(policy==='after_deadline'){
    assert.equal(result.data.summary.correct,null);assert.equal(result.data.summary.accuracy,null);
    await pool.query("UPDATE quant_attempts SET test_snapshot=jsonb_set(test_snapshot,'{revealAt}',to_jsonb($2::text)) WHERE id=$1",[id,new Date(Date.now()-1000).toISOString()]);
    const revealed=await request('/quant/attempts/'+id+'/result',student);assert.equal(revealed.data.revealed,true);assert.ok(revealed.data.items.some((i:any)=>i.correctKey));
   }
  }
 });
 await t.test('actual analytics protect small samples and exclude another student history',async()=>{
  const result=await request('/quant/analytics',student);assert.equal(result.status,200);
  const own=await request('/quant/history',student),others=await request('/quant/history',otherStudent);assert.equal(own.status,200);assert.equal(others.status,200);
  assert.ok(!JSON.stringify(own.data).includes('correctKey'));assert.ok(!JSON.stringify(result.data).includes('correctKey'));
  assert.ok(own.data.some((a:any)=>a.id===attempt));assert.ok(!others.data.some((a:any)=>a.id===attempt));
  assert.ok(result.data.skills.length>0);assert.ok(result.data.skills.every((s:any)=>['insufficient','low'].includes(s.confidence)));
  for(const skill of result.data.skills) assert.equal(skill.mastery,(skill.correct+1)/(skill.attempted+2));
  assert.equal(result.data.summary.accuracy,result.data.summary.correct/(result.data.summary.correct+result.data.summary.wrong));
  assert.equal(result.data.summary.completion,(result.data.summary.correct+result.data.summary.wrong)/result.data.summary.total);
  const repeated=result.data.repeatedErrors.find((r:any)=>r.questionId===questions[0]);assert.ok(repeated);assert.equal(repeated.count,2);
  assert.ok(repeated.basedOnAttemptIds.every((id:string)=>own.data.some((a:any)=>a.id===id)));
  assert.ok(!result.data.repeatedErrors.some((r:any)=>r.questionId===questions[1]));
  assert.ok(!JSON.stringify(result.data).includes(otherStudent));
  for(const recommendation of result.data.recommendations) assert.ok(recommendation.basedOnAttemptIds.every((id:string)=>own.data.some((a:any)=>a.id===id)));
 });
 await t.test('deleting an owned attempt cascades private strokes; another student cannot delete it',async()=>{
  assert.equal((await request('/quant/attempts/'+attempt,otherStudent,undefined,'DELETE')).status,404);
  assert.equal((await request('/quant/attempts/'+attempt,student,undefined,'DELETE')).status,200);
  assert.equal((await request('/quant/attempts/'+attempt,student)).status,404);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM quant_scratchpads WHERE attempt_id=$1',[attempt])).rows[0].n,0);
  assert.ok((await pool.query("SELECT 1 FROM audit_logs WHERE user_id=$1 AND action LIKE '%quant%delete%'",[student])).rowCount);
 });
 await t.test('indexed bank queries handle 2000 original local fixtures and preserve bounded payloads',async()=>{
  const perfCategory=(await request('/education/categories',admin,{name:'مهارة أداء بنك محلي كبير',track:'quantitative'})).data.id;assert.ok(perfCategory);
  const fixtures=Array.from({length:2000},(_,i)=>{
   const stem=`مسألة أصلية لاختبار الأداء ${i+1}: ما ناتج 1 + 1؟`;
   const content={options:[{text:'2'},{text:'3'},{text:'4'},{text:'5'}],answer:0,explanation:'نجمع الواحد مع الواحد فيكون الناتج اثنين.',source:'تأليف اختبار الأداء المحلي',rights:'original',license:'اختبار أصلي محلي فقط',allowSave:true};
   return{id:randomUUID(),version_id:randomUUID(),text:stem,fingerprint:sha256(normalizeForDedup(stem)),normalized_hash:normalizedQuestionHash(stem),content,snapshot:{categoryId:perfCategory,text:stem,difficulty:'easy',status:'published',content}};
  });
  const records=JSON.stringify(fixtures);
  const q=await pool.connect();try{
   await q.query('BEGIN');
   await q.query(`INSERT INTO education_questions(id,category_id,text,fingerprint,difficulty,content,status,author_id,reviewed_by)
    SELECT f.id,$2,f.text,f.fingerprint,'easy',f.content,'published',$3,$4 FROM jsonb_to_recordset($1::jsonb) AS f(id text,text text,fingerprint text,content jsonb)`,[records,perfCategory,writer,admin]);
   await q.query(`INSERT INTO education_question_versions(id,question_id,number,snapshot)
    SELECT f.version_id,f.id,1,f.snapshot FROM jsonb_to_recordset($1::jsonb) AS f(id text,version_id text,snapshot jsonb)`,[records]);
   await q.query(`INSERT INTO quant_question_reviews(version_id,question_id,source_id,source_page,review_status,normalized_hash,skill,reviewed_by)
    SELECT f.version_id,f.id,$2,1,'approved',f.normalized_hash,'مهارة أداء بنك محلي كبير',$3 FROM jsonb_to_recordset($1::jsonb) AS f(id text,version_id text,normalized_hash text)`,[records,authoredSource,admin]);
   await q.query('COMMIT');
  }catch(e){await q.query('ROLLBACK');throw e;}finally{q.release();}
  const began=performance.now();const meta=await request('/quant/meta',student);const ms=performance.now()-began;assert.equal(meta.status,200);
  const skill=meta.data.skills.find((s:any)=>s.id===perfCategory);assert.ok(skill);assert.equal(skill.questionCount,2000);
  assert.ok(JSON.stringify(meta.data).length<100000,'Metadata must aggregate bank counts rather than sending question content.');
  const listed=await request('/quant/admin/questions?search='+encodeURIComponent('مسألة أصلية لاختبار الأداء'),admin);assert.equal(listed.status,200);assert.ok(listed.data.length<=500);
  console.log(`QUANT_BANK_BENCHMARK originalQuestions=2000 metadataRequestMs=${Math.round(ms)} adminPageSize=${listed.data.length}`);
 });
 await t.test('revoking a source prevents new attempts and publishing linked versions',async()=>{
  assert.equal((await request('/quant/admin/sources/'+authoredSource+'/license',admin,{licenseStatus:'restricted',licenseNote:'وقف ترخيص مصدر الاختبار المحلي للتأكد من تطبيق البوابة.'},'PATCH')).status,200);
  assert.equal((await request('/quant/tests/'+testId+'/attempts',student,{})).status,409);
  assert.equal((await request('/quant/admin/tests',admin,{...config,title:'رفض نشر من المصدر الموقوف',status:'published'})).status,409);
 });
 }finally{await new Promise<void>(r=>server.close(()=>r()));await pool.end();}
});
