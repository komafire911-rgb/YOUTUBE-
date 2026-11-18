'use strict';
/* =========================================================
   救急隊 想定訓練シミュレータ — アプリ本体
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLES = {
  cmd:  { name: '隊長',     icon: '🧭', duty: '現場の指揮・状況評価と判断、病歴聴取、医師への連絡、搬送先選定、搬送決定、引継ぎ' },
  crew: { name: '救急隊員', icon: '🩺', duty: 'バイタルサイン測定・身体観察、酸素投与・止血・体位管理などの処置、モニタ管理' },
  drv:  { name: '機関員',   icon: '🚑', duty: '資器材準備・ストレッチャー搬入、関係者への情報収集、時系列記録、経路確認と安全運転' },
};
const ACT = Object.fromEntries(ACTIONS.map(a => [a.id, a]));
const SPEC_IDS = ACTIONS.filter(a => a.spec).map(a => a.id);

const VITAL_KEYS = [
  { k: 'rr',   label: '呼吸数', unit: '回/分' },
  { k: 'hr',   label: '脈拍',   unit: '回/分' },
  { k: 'bp',   label: '血圧',   unit: 'mmHg' },
  { k: 'spo2', label: 'SpO₂',   unit: '%' },
  { k: 'temp', label: '体温',   unit: '℃' },
  { k: 'glu',  label: '血糖',   unit: 'mg/dL' },
  { k: 'jcs',  label: '意識',   unit: '' },
  { k: 'pupil',label: '瞳孔',   unit: '' },
  { k: 'ecg',  label: '心電図', unit: '' },
];
const ACTION_VITALS = {
  o_resp: ['rr'], o_pulse: ['hr'], o_bp: ['bp'], o_spo2: ['spo2'], o_temp: ['temp'],
  o_jcs: ['jcs'], o_pupil: ['pupil'], o_glu: ['glu'], o_ecg: ['ecg', 'hr'],
};

/* ---------------- 設定 ---------------- */
const SETTINGS_KEY = 'emsSim.settings.v1';
const settings = Object.assign({ voice: true, rate: 1.0, auto: 60, trainer: false, sysVoice: '', pVoice: '', names: { cmd: '', crew: '', drv: '' } }, load(SETTINGS_KEY));
function load(k) { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } }
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* 保存不可でも動作 */ } }

/* ---------------- 音声 ---------------- */
const TTS_REPLACE = [[/SpO₂|SpO2/g, 'エスピーオーツー'], [/ECG/g, 'イーシージー'], [/JCS/g, 'ジェイシーエス'], [/AED/g, 'エーイーディー'],
  [/BVM/g, 'ビーブイエム'], [/CPR/g, 'シーピーアール'], [/VF/g, 'ブイエフ'], [/ROSC/g, 'ロスク'], [/mg\/dL/g, 'ミリグラム パー デシリットル'],
  [/mmHg/g, 'ミリメートル エイチジー'], [/℃/g, '度'], [/%/g, 'パーセント'], [/\//g, 'の']];
let voices = [];
function refreshVoices() { if ('speechSynthesis' in window) voices = speechSynthesis.getVoices().filter(v => /^ja/i.test(v.lang)); }
if ('speechSynthesis' in window) { refreshVoices(); speechSynthesis.onvoiceschanged = refreshVoices; }
const VOICE_STYLE = { // kind: [pitch, rateMul, usePatientVoice]
  dispatch: [0.9, 1.0, false], scene: [1.0, 1.0, false], monitor: [1.0, 1.05, false], fb: [0.8, 0.95, false], hospital: [0.85, 1.0, false], mc: [0.85, 1.0, false],
  patient: [1.15, 0.85, true], family: [1.25, 1.1, true],
};
function speak(text, kind = 'scene') {
  if (!settings.voice || !('speechSynthesis' in window) || !text) return;
  let t = text; TTS_REPLACE.forEach(([re, to]) => { t = t.replace(re, to); });
  t = t.replace(/\/--/g, '、拡張期不明').replace(/[()（）]/g, '、');
  const [pitch, rm, pv] = VOICE_STYLE[kind] || VOICE_STYLE.scene;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'ja-JP'; u.pitch = pitch; u.rate = Math.max(0.5, Math.min(2, settings.rate * rm));
  const want = pv ? settings.pVoice : settings.sysVoice;
  const v = voices.find(x => x.voiceURI === want) || (pv && voices.length > 1 ? voices[voices.length - 1] : voices[0]);
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function stopSpeech() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }

/* ---------------- 状態 ---------------- */
let screen = 'home';
let homeFilter = '全て';
let SIM = null;
let timer = null;
const fmtT = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

function newSim(sc) {
  return { sc, phase: 'dispatch', stage: 'initial', elapsed: 0, done: {}, log: [], monitor: {}, fired: new Set(), ng: [], caution: [],
    sceneTime: null, role: 'cmd', ended: false, trainerOpen: false, firstAt: {}, announced: false };
}
function vital(k, stage) { const sc = SIM.sc; return Object.assign({}, sc.vitals.initial, sc.vitals[stage || SIM.stage] || {})[k]; }
function pick(v) { if (v == null) return null; if (typeof v === 'string') return v; return v[SIM.stage] || v.initial || null; }
function roleLabel(r) { const n = settings.names[r]; return ROLES[r].name + (n ? '(' + n + ')' : ''); }

/* ---------------- 画面切替 ---------------- */
function go(s) { screen = s; render(); window.scrollTo(0, 0); }
function render() {
  const app = $('#app');
  if (screen === 'home') app.innerHTML = homeHTML();
  else if (screen === 'brief') app.innerHTML = briefHTML();
  else if (screen === 'sim') { app.innerHTML = simHTML(); renderSim(); }
  else if (screen === 'debrief') app.innerHTML = debriefHTML();
  bind();
}

/* ---------------- ホーム ---------------- */
function homeHTML() {
  const cats = ['全て', ...Array.from(new Set(SCENARIOS.map(s => s.cat)))];
  const list = SCENARIOS.filter(s => homeFilter === '全て' || s.cat === homeFilter);
  return `
  <header class="top"><div class="brand">🚑 救急隊 想定訓練シミュレータ</div>
    <button class="btn ghost" data-act="settings">⚙️ 設定</button></header>
  <main class="wrap">
    <section class="hero">
      <h1>想定を選んで訓練開始</h1>
      <p>指令・現場状況・傷病者の声・バイタルを音声で提示します。隊長・隊員・機関員の役割ごとに行動を選び、<b>各行動の結果がその場で返り、不適切な対応はその場で指摘</b>されます。訓練後は役割別の振り返りが出ます。</p>
      <div class="row">
        <button class="btn primary big" data-act="random">🎲 ランダム出題${homeFilter !== '全て' ? '(' + esc(homeFilter) + ')' : ''}</button>
        <label class="chk"><input type="checkbox" id="chkTrainer" ${settings.trainer ? 'checked' : ''}> 指導者モード(想定名・正解を表示)</label>
      </div>
    </section>
    <div class="chips">${cats.map(c => `<button class="chip ${c === homeFilter ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <div class="cards">${list.map((s, i) => `
      <button class="card" data-sc="${s.id}">
        <div class="card-top"><span class="tag">${esc(s.cat)}</span><span class="lv">${esc(s.level)}</span></div>
        <div class="card-title">${settings.trainer ? esc(s.title) : '想定 ' + (SCENARIOS.indexOf(s) + 1) + '：' + esc(s.cat)}</div>
        <div class="card-sub">${esc(s.dispatch.replace(/^救急指令。/, '').slice(0, 44))}…</div>
      </button>`).join('')}</div>
    <p class="note">※ 訓練用教材です。実際の活動は各地域のMC(メディカルコントロール)プロトコルと指導医の指示に従ってください。想定は <code>scenarios.js</code> に追加できます。</p>
  </main>`;
}

/* ---------------- 役割分担(ブリーフィング) ---------------- */
function briefHTML() {
  const sc = SIM.sc;
  return `
  <header class="top"><button class="btn ghost" data-act="home">← 戻る</button><div class="brand">役割分担</div><span></span></header>
  <main class="wrap">
    <section class="hero">
      <h1>${settings.trainer ? esc(sc.title) : '想定：' + esc(sc.cat)}</h1>
      <p>各役割の担当者名を入力してください(任意)。開始すると<b>指令が音声で流れ</b>ます。</p>
    </section>
    <div class="roles">${Object.keys(ROLES).map(r => `
      <div class="rolecard r-${r}">
        <div class="rname">${ROLES[r].icon} ${ROLES[r].name}</div>
        <input class="inp" data-name="${r}" placeholder="担当者名(任意)" value="${esc(settings.names[r] || '')}">
        <div class="rduty">${ROLES[r].duty}</div>
      </div>`).join('')}</div>
    <div class="row center"><button class="btn primary big" data-act="start">🚨 出場(指令を聞く)</button></div>
  </main>`;
}

/* ---------------- シミュレーション画面 ---------------- */
function simHTML() {
  return `
  <header class="top sim">
    <div class="brand">🚑 <span id="hdrTitle"></span></div>
    <div class="phases" id="phases"></div>
    <div class="timer" id="timer">00:00</div>
    <div class="hbtns">
      <button class="btn ghost" data-act="mute" id="btnMute"></button>
      <button class="btn ghost" data-act="trainer">👨‍🏫 指導者</button>
      <button class="btn danger" data-act="abort">終了</button>
    </div>
  </header>
  <div class="simgrid">
    <section class="col left">
      <div class="panel"><h3>📟 モニタ・測定結果</h3><div class="vitals" id="vitals"></div></div>
      <div class="panel" id="stagebox"></div>
    </section>
    <section class="col mid">
      <div class="panel logpanel"><h3>📋 現場の状況</h3><div id="log" class="log"></div>
        <div id="phaseBtn" class="phasebtn"></div></div>
    </section>
    <section class="col right">
      <div class="tabs" id="tabs"></div>
      <div id="actions"></div>
    </section>
  </div>
  <aside id="trainer" class="trainer" hidden></aside>`;
}

function renderSim() {
  const s = SIM;
  $('#hdrTitle').textContent = settings.trainer ? s.sc.title : '想定：' + s.sc.cat;
  $('#btnMute').textContent = settings.voice ? '🔊 音声ON' : '🔇 音声OFF';
  renderPhases(); renderVitals(); renderLog(); renderActions(); renderPhaseBtn(); renderStage(); renderTrainer();
  $('#timer').textContent = fmtT(s.elapsed);
}
function renderPhases() {
  const P = [['dispatch', '指令'], ['scene', '現場活動'], ['transport', '搬送'], ['ended', '引継ぎ']];
  const idx = P.findIndex(p => p[0] === SIM.phase);
  $('#phases').innerHTML = P.map((p, i) => `<span class="ph ${i < idx ? 'past' : i === idx ? 'now' : ''}">${p[1]}</span>`).join('');
}
function fmtVital(k, v) {
  const def = VITAL_KEYS.find(x => x.k === k);
  const m = /^(\d+(?:\.\d+)?|\d+\/\d+|\d+\/--)(.*)$/.exec(v);
  if (m && def.unit) return `<span class="num">${esc(m[1])}</span><span class="unit">${def.unit}</span>${m[2] ? `<span class="rest">${esc(m[2])}</span>` : ''}`;
  return `<span class="txt">${esc(v)}</span>`;
}
function renderVitals() {
  $('#vitals').innerHTML = VITAL_KEYS.map(d => {
    const m = SIM.monitor[d.k];
    const wide = ['jcs', 'pupil', 'ecg'].includes(d.k) ? ' wide' : '';
    return `<div class="vt${wide} ${m ? 'has' : ''} ${m && m.flash ? 'flash' : ''}"><div class="vl">${d.label}</div><div class="vv">${m ? fmtVital(d.k, m.val) : '<span class="none">未測定</span>'}</div></div>`;
  }).join('');
  Object.values(SIM.monitor).forEach(m => { m.flash = false; });
}
function renderStage() {
  const s = SIM;
  const sc = s.sc;
  $('#stagebox').innerHTML = `<h3>🙂 患者情報</h3><div class="pinfo">${esc(sc.patientInfo || (sc.dispatch.replace(/^救急指令。/, '')))}</div>`;
}
const LOG_ICON = { dispatch: '📻', scene: '🏠', patient: '🗣️', family: '👥', monitor: '📟', crew: '▶', result: '✅', fb: '⚠️', sys: 'ℹ️', mc: '☎️', hospital: '🏥' };
function renderLog() {
  const el = $('#log'); if (!el) return;
  el.innerHTML = SIM.log.map(e => `<div class="le ${e.kind} ${e.lv || ''}"><span class="lt">${fmtT(e.t)}</span><span class="li">${LOG_ICON[e.kind] || '•'}</span><div class="lx">${e.who ? `<b>${esc(e.who)}</b> ` : ''}${esc(e.text)}</div></div>`).join('');
  el.scrollTop = el.scrollHeight;
}
function addLog(kind, text, extra = {}) { SIM.log.push(Object.assign({ kind, text, t: SIM.elapsed }, extra)); renderLog(); }

function renderPhaseBtn() {
  const el = $('#phaseBtn');
  if (SIM.phase === 'dispatch') {
    el.innerHTML = SIM.announced ? '<button class="btn primary big" data-act="arrive">🚨 現着(現場の状況を聞く)</button>'
      : '<button class="btn primary big" data-act="dispatch">📻 指令を聞く</button>';
  } else el.innerHTML = '';
  bindIn(el);
}
function renderActions() {
  const el = $('#actions'); if (!el) return;
  const enabled = SIM.phase !== 'dispatch' && !SIM.ended;
  const cnt = r => ACTIONS.filter(a => a.role === r && SIM.done[a.id]).length;
  $('#tabs').innerHTML = Object.keys(ROLES).map(r => `<button class="tab r-${r} ${SIM.role === r ? 'on' : ''}" data-role="${r}"><span>${ROLES[r].icon} ${ROLES[r].name}</span><i>${cnt(r)}</i></button>`).join('');
  const acts = ACTIONS.filter(a => a.role === SIM.role);
  const groups = [...new Set(acts.map(a => a.grp))];
  el.innerHTML = `<div class="rduty small">${ROLES[SIM.role].duty}</div>` + groups.map(g => `
    <div class="grp"><div class="gname">${esc(g)}</div><div class="abtns">${acts.filter(a => a.grp === g).map(a => {
      const n = SIM.done[a.id] || 0;
      return `<button class="abtn r-${a.role} ${n ? 'done' : ''}" data-a="${a.id}" ${enabled ? '' : 'disabled'}>${esc(a.label)}${a.spec ? '<em>指示要</em>' : ''}${n > 1 ? `<b>×${n}</b>` : ''}</button>`;
    }).join('')}</div></div>`).join('');
  bindIn($('#tabs'));
  bindIn(el);
}

/* ---------------- 進行ロジック ---------------- */
function startSim(sc) {
  SIM = newSim(sc);
  screen = 'sim'; render();
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  doDispatch();
}
function doDispatch() {
  if (SIM.announced) return;
  SIM.announced = true;
  addLog('dispatch', SIM.sc.dispatch, { who: '指令' });
  speak(SIM.sc.dispatch, 'dispatch');
  renderPhaseBtn();
}
function arrive() {
  SIM.phase = 'scene'; SIM.elapsed = 0; $('#timer').textContent = '00:00';
  addLog('scene', SIM.sc.scene, { who: '現着' });
  speak(SIM.sc.scene, 'scene');
  renderPhases(); renderPhaseBtn(); renderActions();
}
function tick() {
  if (!SIM || SIM.ended || SIM.phase === 'dispatch') return;
  SIM.elapsed++;
  $('#timer').textContent = fmtT(SIM.elapsed);
  const w = SIM.sc.worsen;
  if (w && SIM.stage === 'initial' && !SIM.fired.has('worsen') && SIM.elapsed >= w.after && !(w.unless || []).some(id => SIM.done[id])) {
    SIM.fired.add('worsen'); setStage(w.to, w.say);
  }
  if (settings.auto && SIM.elapsed % settings.auto === 0 && (SIM.done.o_spo2 || SIM.done.o_ecg)) autoMonitor();
}
function autoMonitor() {
  const keys = []; if (SIM.done.o_spo2) keys.push('spo2'); if (SIM.done.o_spo2 || SIM.done.o_ecg) keys.push('hr'); if (SIM.done.o_ecg) keys.push('ecg');
  const parts = [];
  keys.forEach(k => { const v = vital(k); SIM.monitor[k] = { val: v, t: SIM.elapsed, flash: true }; parts.push(vitalSpeech(k, v)); });
  renderVitals();
  const text = 'モニタ定期確認：' + parts.join('、');
  addLog('monitor', text, { who: '機関員' }); speak(text, 'monitor');
}
function vitalSpeech(k, v) {
  const def = VITAL_KEYS.find(x => x.k === k);
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(v);
  const suffix = { rr: '回', hr: '回', spo2: 'パーセント', temp: '度', glu: 'ミリグラム' }[k] || '';
  if (m && !/^\d+\/\d+/.test(v)) return `${def.label}、${m[1]}${suffix}${m[2]}`;
  return `${def.label}、${v}`;
}
function setStage(to, say) {
  const prev = {}; Object.keys(SIM.monitor).forEach(k => { prev[k] = SIM.monitor[k].val; });
  SIM.stage = to;
  const fallback = to === 'worse' ? '患者さんの状態が悪化しています!' : '患者さんの状態が改善してきました。';
  const msg = say || fallback;
  addLog('scene', msg, { who: '状況' }); speak(msg, 'scene');
  // 測定済みの項目は値を更新して知らせる
  const changed = [];
  Object.keys(SIM.monitor).forEach(k => {
    const nv = vital(k);
    if (nv !== prev[k]) { SIM.monitor[k] = { val: nv, t: SIM.elapsed, flash: true }; if (!['jcs', 'pupil'].includes(k)) changed.push(vitalSpeech(k, nv)); }
  });
  if (changed.length) { const t = 'モニタ更新：' + changed.join('、'); addLog('monitor', t, { who: 'モニタ' }); speak(t, 'monitor'); }
  renderVitals(); renderTrainer();
}

function run(id) {
  if (SIM.phase === 'dispatch' || SIM.ended) return;
  const a = ACT[id], sc = SIM.sc, who = roleLabel(a.role);
  // 搬送前の引継ぎは不可
  if (id === 'c_handover' && SIM.phase !== 'transport') { addLog('fb', 'まだ搬送が始まっていません。機関員の「現場出発・搬送開始」を先に行ってください。', { who: '指導', lv: 'caution' }); speak('まだ搬送が始まっていません。', 'fb'); return; }
  SIM.done[id] = (SIM.done[id] || 0) + 1;
  if (SIM.firstAt[id] == null) SIM.firstAt[id] = SIM.elapsed;
  addLog('crew', a.label + (SIM.done[id] > 1 ? '(再)' : '') + ' ' + (ACTION_VITALS[id] ? '実施します' : '実施'), { who });
  // --- 指導(判定) ---
  const av = (sc.avoid || {})[id];
  if (av) { feedback(av.lv, av.msg, id); }
  if (SPEC_IDS.includes(id) && !SIM.done.c_mc) feedback('ng', 'いや、これはこうですよ。' + a.label + 'は特定行為です。医師の具体的な指示(オンラインMC)を先に受けてください。', id);
  const rq = (sc.requires || {})[id];
  if (rq && rq.need && rq.need.length && rq.need.some(n => !SIM.done[n])) feedback('ng', rq.msg, id);
  if (id === 'd_drive' && !SIM.done.c_decide) feedback('caution', '搬送の決定は隊長の指示が先です。「搬送決定」の宣言をしてから出発しましょう。', id);
  // --- 結果 ---
  produceResult(id);
  if (id === 'd_drive') { SIM.phase = 'transport'; SIM.sceneTime = SIM.elapsed; renderPhases(); }
  evalTransitions(id);
  renderActions(); renderVitals(); renderTrainer();
  if (id === 'c_handover') endSim();
}
function feedback(lv, msg, id) {
  if (!msg) return;
  (lv === 'ng' ? SIM.ng : SIM.caution).push({ id, msg, t: SIM.elapsed });
  addLog('fb', msg, { who: lv === 'ng' ? '指導(不適切)' : '指導(注意)', lv });
  speak(msg, 'fb');
}
function produceResult(id) {
  const sc = SIM.sc;
  if (ACTION_VITALS[id]) {
    const keys = ACTION_VITALS[id], parts = [], logs = [];
    keys.forEach(k => { const v = vital(k); SIM.monitor[k] = { val: v, t: SIM.elapsed, flash: true }; parts.push(vitalSpeech(k, v)); logs.push(VITAL_KEYS.find(x => x.k === k).label + ' ' + v); });
    let extra = pick((sc.findings || {})[id]);
    if (id === 'o_resp' && !extra) extra = null;
    const text = logs.join(' / ') + (extra ? '。' + extra : '');
    addLog('monitor', text, { who: '測定' });
    speak(parts.join('、') + (extra ? '。' + extra : ''), 'monitor');
    if (id === 'o_jcs') { const sp = (sc.speech || {})[SIM.stage] || (sc.speech || {}).initial; if (sp) { addLog('patient', sp, { who: '傷病者' }); speak(sp, 'patient'); } }
    return;
  }
  if (id === 'c_contact') {
    const sp = (sc.speech || {})[SIM.stage] || (sc.speech || {}).initial;
    addLog('result', '傷病者に接触。声をかけます。', { who: '状況' });
    if (sp) { addLog('patient', sp, { who: '傷病者' }); speak(sp, 'patient'); }
    return;
  }
  if (id === 'c_history') { const t = sc.history || DEFAULT_RESULT.c_history; addLog('family', t, { who: '聴取結果' }); speak(t.replace(/([SAMPLE])：/g, '$1、'), 'family'); return; }
  if (id === 'c_family' || id === 'd_info') {
    const base = id === 'c_family' ? (sc.family || DEFAULT_RESULT.c_family) : (sc.family ? sc.family : DEFAULT_RESULT.d_info);
    addLog('family', base, { who: id === 'd_info' ? '関係者' : '関係者' }); speak(base, 'family'); return;
  }
  let t = pick((sc.findings || {})[id]) || DEFAULT_RESULT[id] || '実施しました。';
  const kind = id === 'c_hospital' ? 'hospital' : id === 'c_mc' ? 'mc' : 'scene';
  addLog(id === 'c_hospital' ? 'hospital' : id === 'c_mc' ? 'mc' : 'result', t, { who: id === 'c_mc' ? '医師' : id === 'c_hospital' ? '病院' : '' });
  speak(t, kind);
}
function evalTransitions(id) {
  (SIM.sc.transitions || []).forEach((tr, i) => {
    if (SIM.fired.has(i) || SIM.stage === tr.to) return;
    const trig = [...(tr.any || []), ...(tr.all || [])];
    if (!trig.includes(id)) return;
    if (tr.from && !tr.from.includes(SIM.stage)) return;
    const all = (tr.all || []).every(x => SIM.done[x]);
    const any = !tr.any || tr.any.some(x => SIM.done[x]);
    if (all && any) { SIM.fired.add(i); setStage(tr.to, tr.say); }
  });
}

/* ---------------- 終了・振り返り ---------------- */
function endSim() {
  SIM.ended = true; SIM.phase = 'ended'; clearInterval(timer);
  const t = '病院に到着し、引継ぎが完了しました。訓練を終了します。';
  addLog('sys', t, { who: '訓練' }); speak(t, 'scene');
  setTimeout(() => go('debrief'), 1800);
}
function evaluate() {
  const sc = SIM.sc;
  const map = new Map(BASE_REQ.map(r => [r.ids.join(','), r]));
  // 想定ごとの上書き(ids の先頭が一致する基本項目は置き換え)
  const reqs = [...BASE_REQ];
  (sc.req || []).forEach(r => {
    const i = reqs.findIndex(b => b.ids[0] === r.ids[0]);
    if (i >= 0) reqs[i] = Object.assign({}, reqs[i], r); else reqs.push(r);
  });
  const items = reqs.map(r => ({ ...r, ok: r.ids.some(id => SIM.done[id]), role: ACT[r.ids[0]].role }));
  const total = items.reduce((s, r) => s + r.w, 0), got = items.filter(r => r.ok).reduce((s, r) => s + r.w, 0);
  const score = Math.max(0, Math.round(got / total * 100) - SIM.ng.length * 5 - SIM.caution.length * 2);
  const missedCrit = items.filter(r => !r.ok && r.crit);
  return { items, score, missedCrit, got, total };
}
function debriefHTML() {
  const s = SIM, sc = s.sc, ev = evaluate();
  const grade = ev.missedCrit.length ? (ev.score >= 70 ? 'B' : 'C') : (ev.score >= 90 ? 'S' : ev.score >= 75 ? 'A' : 'B');
  const lim = sc.sceneLimit || 600;
  const sceneOK = s.sceneTime != null && s.sceneTime <= lim;
  const byRole = r => ev.items.filter(i => i.role === r);
  return `
  <header class="top"><div class="brand">📝 振り返り</div><span></span>
    <button class="btn ghost" data-act="home">ホームへ</button></header>
  <main class="wrap">
    <section class="hero score">
      <div class="grade g-${grade}">${grade}</div>
      <div>
        <h1>${esc(sc.title)}</h1>
        <p>達成度 <b>${ev.score}点</b>(基準点 ${ev.got}/${ev.total}、不適切な対応 ${s.ng.length}件 / 注意 ${s.caution.length}件)</p>
        <p>現場滞在時間：<b class="${sceneOK ? 'ok' : 'bad'}">${s.sceneTime != null ? fmtT(s.sceneTime) : '搬送せず'}</b>(目標 ${fmtT(lim)}以内) ／ 患者の状態：<b>${stageName(s.stage)}</b></p>
        <p class="muted">想定の正解：${esc(sc.truth)}</p>
      </div>
    </section>
    ${ev.missedCrit.length ? `<section class="alert"><b>⚠ 重要項目の実施漏れ</b><ul>${ev.missedCrit.map(r => `<li><b>${esc(r.label)}</b>…${esc(r.why)}</li>`).join('')}</ul></section>` : '<section class="okbox">✅ 重要項目はすべて実施できました。</section>'}
    ${s.ng.length ? `<section class="panel"><h3>❌ 不適切な対応(いや、これはこうですよ)</h3><ul class="fbl">${s.ng.map(n => `<li><span class="lt">${fmtT(n.t)}</span> <b>${esc(ACT[n.id].label)}</b><br>${esc(n.msg)}</li>`).join('')}</ul></section>` : ''}
    ${s.caution.length ? `<section class="panel"><h3>⚠ 注意</h3><ul class="fbl">${s.caution.map(n => `<li><span class="lt">${fmtT(n.t)}</span> <b>${esc(ACT[n.id].label)}</b><br>${esc(n.msg)}</li>`).join('')}</ul></section>` : ''}
    <div class="rolegrid">${Object.keys(ROLES).map(r => `
      <section class="panel r-${r}"><h3>${ROLES[r].icon} ${roleLabel(r)}</h3>
        <div class="muted">実施 ${ACTIONS.filter(a => a.role === r && s.done[a.id]).length} 項目</div>
        <ul class="chk">${byRole(r).map(i => `<li class="${i.ok ? 'y' : 'n'}">${i.ok ? '✔' : '✖'} ${esc(i.label)}${i.crit ? ' <em>重要</em>' : ''}${i.ok ? '' : `<div class="why">${esc(i.why)}</div>`}</li>`).join('') || '<li class="muted">この役割の評価項目はありません</li>'}</ul>
      </section>`).join('')}</div>
    <section class="panel"><h3>💡 この想定のポイント</h3><ul>${(sc.points || []).map(p => `<li>${esc(p)}</li>`).join('')}</ul></section>
    <section class="panel"><h3>🕒 活動の時系列</h3><ol class="tl">${s.log.filter(e => e.kind === 'crew' || e.kind === 'fb').map(e => `<li class="${e.kind} ${e.lv || ''}"><span class="lt">${fmtT(e.t)}</span> ${e.who ? '<b>' + esc(e.who) + '</b> ' : ''}${esc(e.text)}</li>`).join('')}</ol></section>
    <div class="row center">
      <button class="btn primary big" data-act="again">🔁 同じ想定をもう一度</button>
      <button class="btn big" data-act="random">🎲 別の想定</button>
      <button class="btn big" data-act="copylog">📋 記録をコピー</button>
    </div>
  </main>`;
}
const stageName = s => ({ initial: '初期状態', improved: '改善', worse: '悪化', rosc: '心拍再開(ROSC)' }[s] || s);
function logText() {
  const s = SIM; const ev = evaluate();
  return [`【${s.sc.title}】達成度${ev.score}点 現場滞在 ${s.sceneTime != null ? fmtT(s.sceneTime) : '-'}`, ...s.log.map(e => `${fmtT(e.t)} ${e.who ? e.who + ' ' : ''}${e.text}`)].join('\n');
}

/* ---------------- 指導者パネル ---------------- */
function renderTrainer() {
  const el = $('#trainer'); if (!el) return;
  el.hidden = !SIM.trainerOpen; if (!SIM.trainerOpen) return;
  const sc = SIM.sc, ev = evaluate();
  const stages = Object.keys(sc.vitals);
  el.innerHTML = `
    <div class="tr-head"><b>👨‍🏫 指導者パネル</b><button class="btn ghost" data-act="trainer">閉じる</button></div>
    <div class="tr-sec"><div class="muted">想定の正解</div><div>${esc(sc.truth)}</div></div>
    <div class="tr-sec"><div class="muted">患者の状態を操作(現在：${stageName(SIM.stage)})</div>
      <div class="row">${stages.map(st => `<button class="btn ${st === SIM.stage ? 'primary' : ''}" data-stage="${st}">${stageName(st)}</button>`).join('')}</div></div>
    <div class="tr-sec"><div class="muted">真の現在値(未測定の項目も含む)</div>
      <div class="truevit">${VITAL_KEYS.map(d => `<span><b>${d.label}</b> ${esc(vital(d.k))}</span>`).join('')}</div></div>
    <div class="tr-sec"><div class="muted">患者・家族の声を自由に読み上げ</div>
      <div class="row"><input class="inp" id="freeText" placeholder="例：先生、うちの人は大丈夫ですか?">
      <button class="btn" data-say="patient">患者</button><button class="btn" data-say="family">家族</button></div></div>
    <div class="tr-sec"><div class="muted">評価項目の進み具合</div>
      <ul class="chk">${ev.items.map(i => `<li class="${i.ok ? 'y' : 'n'}">${i.ok ? '✔' : '□'} ${esc(i.label)}${i.crit ? ' <em>重要</em>' : ''}</li>`).join('')}</ul></div>
    <div class="tr-sec"><div class="row"><button class="btn" data-act="repeat">🔁 最後の発話を再読み上げ</button><button class="btn" data-act="mute2">音声 ${settings.voice ? 'OFFにする' : 'ONにする'}</button></div></div>`;
  bindIn(el);
}

/* ---------------- 設定ダイアログ ---------------- */
function openSettings() {
  refreshVoices();
  const opts = (sel) => `<option value="">自動</option>` + voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === sel ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  const d = document.createElement('div'); d.className = 'modal'; d.innerHTML = `
    <div class="mbox"><h2>⚙️ 設定</h2>
      <label class="chk"><input type="checkbox" id="sVoice" ${settings.voice ? 'checked' : ''}> 音声読み上げ</label>
      <label>読み上げ速度 <b id="rateV">${settings.rate.toFixed(1)}</b><input type="range" id="sRate" min="0.6" max="1.4" step="0.1" value="${settings.rate}"></label>
      <label>指令・モニタ・指導の声<select id="sSys">${opts(settings.sysVoice)}</select></label>
      <label>傷病者・家族の声<select id="sP">${opts(settings.pVoice)}</select></label>
      <label>モニタの自動読み上げ間隔<select id="sAuto">${[[0, '行わない'], [30, '30秒ごと'], [60, '60秒ごと'], [120, '120秒ごと']].map(([v, l]) => `<option value="${v}" ${settings.auto === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="muted">※ iPad では音声はボタン操作の後に再生されます。マナーモードを解除し、音量を上げてください。日本語の声が出ない場合は「設定→アクセシビリティ→読み上げコンテンツ→声」で日本語の声をダウンロードしてください。</p>
      <div class="row"><button class="btn" id="sTest">▶ 試し聞き</button><button class="btn primary" id="sClose">閉じる</button></div>
    </div>`;
  document.body.appendChild(d);
  $('#sRate', d).oninput = e => { $('#rateV', d).textContent = (+e.target.value).toFixed(1); };
  $('#sTest', d).onclick = () => { apply(); stopSpeech(); speak('指令。市内、住宅。68歳男性、呼吸困難。意識あり。', 'dispatch'); speak('はぁ…はぁ…苦しい…', 'patient'); };
  const apply = () => { settings.voice = $('#sVoice', d).checked; settings.rate = +$('#sRate', d).value; settings.sysVoice = $('#sSys', d).value; settings.pVoice = $('#sP', d).value; settings.auto = +$('#sAuto', d).value; saveSettings(); };
  $('#sClose', d).onclick = () => { apply(); d.remove(); if (SIM && screen === 'sim') renderSim(); };
}

/* ---------------- イベント ---------------- */
function pickRandom() {
  const pool = SCENARIOS.filter(s => homeFilter === '全て' || s.cat === homeFilter);
  return pool[Math.floor(Math.random() * pool.length)];
}
function prepare(sc) { SIM = newSim(sc); go('brief'); }
function bind() { bindIn(document); }
function bindIn(root) {
  root.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => act(b.dataset.act); });
  root.querySelectorAll('[data-sc]').forEach(b => { b.onclick = () => prepare(SCENARIOS.find(s => s.id === b.dataset.sc)); });
  root.querySelectorAll('[data-cat]').forEach(b => { b.onclick = () => { homeFilter = b.dataset.cat; render(); }; });
  root.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => run(b.dataset.a); });
  root.querySelectorAll('[data-role]').forEach(b => { b.onclick = () => { SIM.role = b.dataset.role; renderActions(); }; });
  root.querySelectorAll('[data-name]').forEach(i => { i.oninput = () => { settings.names[i.dataset.name] = i.value; saveSettings(); }; });
  root.querySelectorAll('[data-stage]').forEach(b => { b.onclick = () => { if (SIM.stage !== b.dataset.stage) setStage(b.dataset.stage, '(指導者操作)患者の状態が' + stageName(b.dataset.stage) + 'に変化しました。'); }; });
  root.querySelectorAll('[data-say]').forEach(b => { b.onclick = () => { const t = $('#freeText').value.trim(); if (t) { addLog(b.dataset.say, t, { who: b.dataset.say === 'patient' ? '傷病者' : '関係者' }); speak(t, b.dataset.say); $('#freeText').value = ''; } }; });
  const ct = root.querySelector('#chkTrainer'); if (ct) ct.onchange = () => { settings.trainer = ct.checked; saveSettings(); render(); };
}
function act(a) {
  switch (a) {
    case 'home': stopSpeech(); clearInterval(timer); go('home'); break;
    case 'settings': openSettings(); break;
    case 'random': prepare(pickRandom()); break;
    case 'start': startSim(SIM.sc); break;
    case 'dispatch': doDispatch(); break;
    case 'arrive': arrive(); break;
    case 'again': prepare(SIM.sc); break;
    case 'mute': settings.voice = !settings.voice; saveSettings(); if (!settings.voice) stopSpeech(); $('#btnMute').textContent = settings.voice ? '🔊 音声ON' : '🔇 音声OFF'; break;
    case 'mute2': settings.voice = !settings.voice; saveSettings(); if (!settings.voice) stopSpeech(); renderSim(); break;
    case 'trainer': SIM.trainerOpen = !SIM.trainerOpen; renderTrainer(); break;
    case 'repeat': { const l = [...SIM.log].reverse().find(e => ['scene', 'patient', 'family', 'dispatch', 'monitor'].includes(e.kind)); if (l) speak(l.text, l.kind); break; }
    case 'abort': if (confirm('訓練を終了して振り返りに進みますか?')) { SIM.ended = true; clearInterval(timer); stopSpeech(); go('debrief'); } break;
    case 'copylog': { const t = logText(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => alert('コピーしました'), () => prompt('コピーしてください', t)); break; }
  }
}

render();
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
