import { useId, useState } from 'react';
import type { ChemistryResult, Simulation } from './chemistry-lab';
import './chemistry-game.css';

const names: Record<string, string> = { 'Mg(OH)2': 'هيدروكسيد المغنيسيوم', HCl: 'حمض الهيدروكلوريك', CaCO3: 'كربونات الكالسيوم', NaCl: 'كلوريد الصوديوم', KCl: 'كلوريد البوتاسيوم', H2O: 'الماء', MgCl2: 'كلوريد المغنيسيوم', CaCl2: 'كلوريد الكالسيوم', CO2: 'ثاني أكسيد الكربون' };

/** Visual feedback follows the server's supported result; no invented reaction engine. */
export function ChemistryGame({ simulation, result, busy, onRun }: { simulation: Simulation; result?: ChemistryResult; busy: boolean; onRun: (prediction: boolean) => void }) {
  const id = useId().replace(/:/g, '');
  const [added, setAdded] = useState<number[]>([]);
  const [prediction, setPrediction] = useState<boolean | null>(null);
  const [angle, setAngle] = useState(0);
  const [view, setView] = useState<'bench' | 'particles'>('bench');
  const [mixed, setMixed] = useState(false);
  const [notice, setNotice] = useState('اختر زجاجة لإضافة مادتها إلى الوعاء، أو اسحبها إليه.');
  const ready = simulation.reactants.length >= 2 && added.length === simulation.reactants.length;
  const shown = mixed && !busy && result?.supported && !!result.reaction;
  const gas = shown && result.reaction!.products.some(p => p.phase === 'g');
  function add(index: number) {
    if (busy || mixed || added.includes(index)) return;
    setAdded(old => [...old, index]);
    setNotice('أُضيفت مادة ' + (names[simulation.reactants[index]] || simulation.reactants[index]) + '.');
  }
  function reset() { setAdded([]); setPrediction(null); setMixed(false); setNotice('أُفرغ الوعاء. يمكنك بدء تجربة جديدة.'); }
  return <section className="chem-game" aria-label="طاولة المختبر التفاعلية" dir="rtl">
    <header className="chem-game-header"><div><span className="chem-kicker">سديم · مختبر الاستكشاف</span><h3>جرّب. توقّع. اكتشف.</h3><p>محاكاة بصرية تعليمية للنماذج الموثقة</p></div><span className="chem-status">{busy ? 'جار فحص التفاعل' : shown ? 'اكتمل النموذج' : 'المختبر جاهز'}</span></header>
    <ol className="chem-steps" aria-label="خطوات التجربة"><li className={ready ? 'done' : ''}>١ أضف المواد</li><li className={prediction !== null ? 'done' : ''}>٢ اختر توقعك</li><li className={shown ? 'done' : ''}>٣ شاهد النتيجة</li></ol>
    <div className="chem-layout"><aside className="chem-shelf" aria-label="رف المواد"><h4>المواد المختارة</h4><p>اضغط للإضافة · يدعم اللمس</p>{simulation.reactants.map((formula, index) => <button key={index} className={'chem-bottle ' + (added.includes(index) ? 'added' : '')} disabled={busy || mixed || added.includes(index)} draggable={!busy && !mixed && !added.includes(index)} onDragStart={e => e.dataTransfer.setData('text/plain', 'chem-material:' + index)} onClick={() => add(index)} aria-label={'إضافة ' + (names[formula] || formula)}><span className="chem-bottle-icon" aria-hidden="true"><i /></span><strong>{names[formula] || formula}</strong><bdi>{formula}</bdi><small>{added.includes(index) ? '✓ أُضيفت للوعاء' : '＋ أضف إلى الوعاء'}</small></button>)}</aside>
    <div className={'chem-stage ' + (shown ? 'chem-active' : '')} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const match = /^chem-material:(\d+)$/.exec(e.dataTransfer.getData('text/plain')); if (match && Number(match[1]) < simulation.reactants.length) add(Number(match[1])); }}>
      <div className="chem-stage-tabs"><button aria-pressed={view === 'bench'} onClick={() => setView('bench')}>طاولة المختبر</button><button aria-pressed={view === 'particles'} onClick={() => setView('particles')}>الجسيمات</button></div>
      <svg className="chem-scene" viewBox="0 0 700 450" role="img" aria-label={shown ? result.reaction!.observation : 'وعاء افتراضي يحتوي على ' + added.length + ' من المواد المختارة'}>
        <defs><linearGradient id={id + 'glass'} x1="0" x2="1"><stop stopColor="#8cdbe3" stopOpacity=".25"/><stop offset=".4" stopColor="#dcffff" stopOpacity=".05"/><stop offset="1" stopColor="#93d8ff" stopOpacity=".3"/></linearGradient><linearGradient id={id + 'table'} x2="0" y2="1"><stop stopColor="#314350"/><stop offset="1" stopColor="#101c29"/></linearGradient><radialGradient id={id + 'light'}><stop stopColor="#61e7c0" stopOpacity=".17"/><stop offset="1" stopColor="#61e7c0" stopOpacity="0"/></radialGradient><clipPath id={id + 'cup'}><path d="M244 150 L257 353 Q350 392 443 353 L456 150Z"/></clipPath></defs>
        <ellipse cx="350" cy="220" rx="260" ry="205" fill={'url(#' + id + 'light)'}/><path d="M70 345 L610 345 L690 407 L10 407Z" fill={'url(#' + id + 'table)'}/><path d="M10 407H690V427H10Z" fill="#0a1422"/><ellipse cx="350" cy="380" rx="135" ry="18" fill="#000" opacity=".35"/>
        <g transform={`translate(${angle * .5} 0) rotate(${angle * .08} 350 250)`}>
          <path d="M244 150 L257 353 Q350 392 443 353 L456 150" fill={'url(#' + id + 'glass)'} stroke="#9bcfdc" strokeWidth="3"/>
          <g clipPath={'url(#' + id + 'cup)'}>
            {added.length > 0 && <><rect x="245" y={325 - added.length * 47} width="220" height="180" fill={shown ? '#6abfca' : '#7f9be3'} opacity=".42"/><ellipse cx="350" cy={325 - added.length * 47} rx="109" ry="18" fill={shown ? '#91dedc' : '#a9bfff'} opacity=".7"/></>}
            {gas && Array.from({length: 12}, (_, n) => <circle key={n} className="chem-bubble" cx={278 + (n * 37) % 145} cy={310 - (n * 19) % 130} r={3 + n % 5} fill="none" stroke="#dcffff" style={{animationDelay: `${n * -.23}s`}}/>)}
            {view === 'particles' && (shown ? result.reaction!.products.map(p => p.formula) : added.map(n => simulation.reactants[n])).map((formula, n) => <g key={n} className="chem-particle" transform={`translate(${295 + n % 3 * 52},${260 + Math.floor(n / 3) * 40})`}><circle r="22" fill={n % 2 ? '#a393eb' : '#59bea6'} stroke="#ecffff"/><text y="4" textAnchor="middle" fill="white" fontSize="10">{formula}</text></g>)}
          </g><ellipse cx="350" cy="150" rx="106" ry="21" fill="#081727" fillOpacity=".3" stroke="#b5e4ec" strokeWidth="3"/><path d="M267 170L277 342" stroke="#ecffff" opacity=".45" strokeWidth="5"/>{[0,1,2,3,4].map(n=><path key={n} d={`M415 ${190+n*31}h20`} stroke="#c9e7f2" opacity=".7"/>)}
          <text x="350" y="118" fill="#c9e8f1" textAnchor="middle" fontSize="15">{added.length === 0 ? 'أضف المواد هنا' : shown ? 'نتيجة النموذج' : 'جاهز للخلط'}</text>
        </g>
      </svg>
      <label className="chem-camera">زاوية العرض <input type="range" min="-35" max="35" value={angle} onChange={e => setAngle(Number(e.target.value))}/></label>
      <p className="chem-note">المشهد ذو عمق بصري؛ حركة الجسيمات والفقاعات توضيحية، وليست قياسًا لمعدل التفاعل.</p>
    </div></div>
    <div className="chem-controls"><fieldset><legend>ماذا تتوقع بعد الخلط؟</legend><button disabled={busy || mixed} aria-pressed={prediction === true} onClick={() => setPrediction(true)}>سيحدث تفاعل</button><button disabled={busy || mixed} aria-pressed={prediction === false} onClick={() => setPrediction(false)}>لا تفاعل صافٍ</button></fieldset><button className="chem-mix" disabled={!ready || prediction === null || busy || mixed} onClick={() => { setMixed(true); setNotice('جار التحقق من النموذج الكيميائي…'); onRun(prediction!); }}>⚗ {busy ? 'جار الخلط…' : 'اخلط المواد'}</button><button disabled={busy} onClick={reset}>أفرغ الوعاء</button></div>
    <div className="chem-feedback" role="status" aria-live="polite">{mixed && result && !busy ? result.supported && result.reaction ? <><strong>{result.predictionCorrect ? '✦ أحسنت! توقعك صحيح' : 'جرّب التفكير في النواتج مرة أخرى'}</strong><p>{result.reaction.observation}</p><bdi>{result.equation}</bdi></> : <p>{result.message || 'هذه المواد خارج النماذج المدعومة؛ لم يتم تمثيل تفاعل.'}</p> : notice}</div>
  </section>;
}
