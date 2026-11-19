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
let speakingN = 0, listening = false, autoListen = false, rec = null;
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
  speakingN++; if (listening) abortListen();   // 読み上げ中はマイクを止める(自分の声を拾わない)
  u.onend = u.onerror = () => { speakingN = Math.max(0, speakingN - 1); if (speakingN === 0 && autoListen) setTimeout(startListen, 600); };
  speechSynthesis.speak(u);
}
function stopSpeech() { speakingN = 0; if ('speechSynthesis' in window) speechSynthesis.cancel(); }

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
function go(s) { screen = s; if (s !== 'sim') { autoListen = false; abortListen(); } render(); window.scrollTo(0, 0); }
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
        <div id="phaseBtn" class="phasebtn"></div>
        <div class="voicebar">
          <div class="vrow"><button class="btn primary mic" id="micBtn">🎤 話す</button>
            <label class="chk"><input type="checkbox" id="autoChk"> 常時聴取</label><span id="micState" class="muted"></span></div>
          <div id="transcript" class="transcript">例：「隊員、バイタル測定」「血圧は?」「酸素10リットル」「機関員、ストレッチャー準備」「ご家族に話を聞く」「病院に連絡」</div>
          <div class="vrow"><input class="inp" id="cmdInput" placeholder="キーボードで指示を入力(例：隊員、血圧測定)"><button class="btn" id="cmdSend">送信</button></div>
        </div></div>
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
  initVoiceBar();
}
function renderPhases() {
  const P = [['dispatch', '指令'], ['scene', '現場活動'], ['transport', '搬送'], ['ended', '引継ぎ']];
  const idx = P.findIndex(p => p[0] === SIM.phase);
  $('#phases').innerHTML = P.map((p, i) => `<span class="ph ${i < idx ? 'past' : i === idx ? 'now' : ''}">${p[1]}</span>`).join('');
}
function fmtVital(k, v) {
  const def = VITAL_KEYS.find(x => x.k === k);
  const m = /^(\d+\/(?:\d+|--)|\d+(?:\.\d+)?)(.*)$/.exec(v);
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
const LOG_ICON = { say: '🎙️', dispatch: '📻', scene: '🏠', patient: '🗣️', family: '👥', monitor: '📟', crew: '▶', result: '✅', fb: '⚠️', sys: 'ℹ️', mc: '☎️', hospital: '🏥' };
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
let PFX = true;
const rep = id => (PFX ? ROLES[ACT[id].role].name + '、' : '');
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
  if ('speechSynthesis' in window && speakingN > 0 && !speechSynthesis.speaking && !speechSynthesis.pending) speakingN = 0;
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

function run(id, opts = {}) {
  PFX = opts.prefix !== false;
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
    speak(rep(id) + parts.join('、') + (extra ? '。' + extra : ''), 'monitor');
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
  speak((kind === 'scene' ? rep(id) : '') + t, kind);
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
    <section class="panel"><h3>🕒 活動の時系列</h3><ol class="tl">${s.log.filter(e => e.kind === 'crew' || e.kind === 'fb' || e.kind === 'say').map(e => `<li class="${e.kind} ${e.lv || ''}"><span class="lt">${fmtT(e.t)}</span> ${e.who ? '<b>' + esc(e.who) + '</b> ' : ''}${esc(e.text)}</li>`).join('')}</ol></section>
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


/* ---------------- 音声操作(口頭指示・口頭報告) ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const O2LOW = /カニュラ|鼻|低流量|(^|[^0-9])[123](リットル|l)/;
// [行動ID(配列) または 関数, 正規表現] 具体的なものを先に。一致部分は消費して重複判定を防ぐ
const VR = [
  [['o_resp', 'o_pulse', 'o_bp', 'o_spo2', 'o_jcs', 'o_temp'], /バイタル/],
  [['c_primary'], /初期評価|abcd|abc|エービーシー|気道.{0,3}呼吸.{0,3}循環/],
  [['c_secondary'], /全身観察|頭から足|全身を見/],
  [['o_12'], /(12|十二|じゅうに)誘導(心電図)?/],
  [['o_ecg'], /心電図|モニター|モニタ|心電/],
  [['o_spo2'], /spo2|spo|エスピーオー|サチュ|酸素飽和|パルスオキシ|パルオキ/],
  [['t_iv'], /静脈路|ルート確保|ルートを取|ライン確保|点滴確保|点滴のルート/],
  [['t_glucose'], /ブドウ糖|50%|グルコース/],
  [['t_fluid'], /輸液|リンゲル|ラクテック|点滴/],
  [['t_epi'], /エピペン|アドレナリン|エピネフリン/],
  [['d_stretch'], /ストレッチャー(準備|搬入|を)?|担架/],
  [['d_drive'], /出発|出して|発進|搬送開始|走らせ|現場を出|現場出|向かって|向かえ/],
  [['c_handover'], /引継|引き継|病着|病院(に)?到着|到着しました/],
  [['c_decide'], /搬送決定|搬送する|搬送を決|搬送します|収容|ロード.{0,3}ゴー|ロードアンドゴー/],
  [['c_hospital'], /病院|選定|受け入れ|受入|搬送先/],
  [['c_mc'], /指示要請|医師|ドクター(?!カー|ヘリ)|オンライン|エムシー|mc|特定行為/],
  [['c_support'], /応援|ドクターカー|ドクターヘリ|ヘリ|pa連携/],
  [['o_bp'], /血圧|ケツアツ/],
  [['o_glu'], /血糖/],
  [['o_temp'], /体温|検温|熱を|熱は/],
  [['o_pupil'], /瞳孔|対光/],
  [['o_lung'], /聴診|呼吸音|肺音|胸の音/],
  [['o_resp'], /呼吸数|呼吸観察|呼吸状態|呼吸/],
  [['o_pulse'], /脈拍|脈/],
  [['o_jcs'], /意識レベル|ジェイシーエス|jcs|声かけ|声掛け|意識/],
  [['o_abd'], /腹部|お腹を|おなかを/],
  [['o_skin'], /皮膚|冷汗|顔色/],
  [['o_neuro'], /麻痺|cpss|シーピーエスエス|脳卒中スケール/],
  [['o_trauma'], /外傷|受傷|けがの|怪我の/],
  [['t_cpr'], /胸骨圧迫|心臓マッサージ|cpr|シーピーアール|心マ/],
  [['t_bvm'], /bvm|ビーブイエム|補助換気|バッグ|人工呼吸|換気/],
  [['t_aed'], /aed|エーイーディー|除細動|パッド|ショックを(かけ|打|実施)|ショックボタン/],
  [['t_airway'], /気道確保|気道を|吸引|エアウェイ|下顎挙上|頭部後屈/],
  [['t_hemo'], /止血|直接圧迫|圧迫して|止血帯|圧迫/],
  [['t_splint'], /固定|シーネ|バインダー|スプリント/],
  [['t_warm'], /保温|毛布|ブランケット|温め/],
  [['t_cool'], /冷却|冷や|冷た|アイスパック|氷|日陰|涼し/],
  [['t_pos_shock'], /下肢挙上|(足|脚)を(上|挙|あげ)|ショック体位/],
  [['t_pos_semi'], /半坐位|半座位|起坐|起座|座らせ|ファーラー|楽な体位|坐位|座位/],
  [['t_pos_lat'], /側臥位|回復体位|横向き|横に向け/],
  [['t_pos_supine'], /仰臥位|仰向け|寝かせ|水平/],
  [t => (O2LOW.test(t) ? ['t_o2_low'] : ['t_o2_mask']), /酸素|オーツー|オキシジェン|o2/],
  [['t_oral'], /飲ませ|飲水|水を飲|経口|糖分/],
  [['x_bite'], /噛ませ|かませ|タオルを(口|噛)|舌を噛/],
  [['x_walk'], /歩かせ|歩行|歩いて|立たせ|立って/],
  [['x_nitro'], /ニトロ/],
  [['d_prep'], /資器材|機材|準備/],
  [['d_info'], /お薬手帳|薬手帳|保険証/],
  [['d_record'], /記録|時刻を|メモ/],
  [['d_route'], /経路|所要時間|渋滞|ルート確認/],
  [['c_safe'], /安全確認|ビーエスアイ|bsi|感染防御|手袋|現場の安全/],
  [['c_contact'], /接触|第一印象|話しかけ|声をかけ|聞こえますか|お名前|わかりますか|分かりますか|大丈夫ですか/],
  [['c_family'], /家族|奥さん|妻|旦那|ご主人|同僚|関係者|目撃|駅員|友人|母親|お母さん/],
  [['c_history'], /病歴聴取|サンプル|sample|opqrst|オプクエスト|聴取/],
];
// 傷病者・家族への質問(SAMPLE各項目)
const QA = [
  ['S', '症状', /どうしました|どうされ|症状|どこが痛|痛み|苦しい|主訴|何が/],
  ['A', 'アレルギー', /アレルギー/],
  ['M', '内服薬', /薬|服薬|内服|インスリン/],
  ['P', '既往歴', /既往|持病|病気|通院|かかりつけ|病歴/],
  ['L', '最後の食事', /食事|食べ/],
  ['E', '発症の経過', /いつから|経緯|経過|何があった|発症|きっかけ|いつ頃|いつごろ/],
];
function parseCommands(t) {
  let s = t; const hits = [];
  for (const [ids, re] of VR) {
    for (;;) {
      const m = re.exec(s); if (!m) break;
      hits.push({ pos: m.index, ids: typeof ids === 'function' ? ids(t) : ids });
      s = s.slice(0, m.index) + '\u0000'.repeat(m[0].length) + s.slice(m.index + m[0].length);
    }
  }
  return { hits: hits.sort((a, b) => a.pos - b.pos), rest: s };
}
function roleMentions(t) {
  const out = []; const re = /救急隊員|隊員|機関員|機関|隊長/g; let m;
  while ((m = re.exec(t))) out.push({ pos: m.index, role: /隊長/.test(m[0]) ? 'cmd' : /機関/.test(m[0]) ? 'drv' : 'crew' });
  return out;
}
function historyFields() {
  const o = {};
  (SIM.sc.history || '').split(/。(?=[SAMPLE]：)/).forEach(seg => { const m = /^([SAMPLE])：([\s\S]*)$/.exec(seg.replace(/。$/, '')); if (m) o[m[1]] = m[2]; });
  return o;
}
function askHistory(qa) {
  const f = historyFields();
  const conscious = /^JCS (0|1\b|I-)/.test(vital('jcs'));
  const kind = conscious ? 'patient' : 'family';
  qa.forEach(([k, label]) => {
    const v = f[k] || '不明です';
    addLog('family', label + '：' + v, { who: conscious ? '傷病者' : '関係者' });
    speak(label + '、' + v, kind);
  });
  if (!SIM.done.c_history) SIM.firstAt.c_history = SIM.elapsed;
  SIM.done.c_history = (SIM.done.c_history || 0) + 1;
  addLog('crew', '病歴聴取(口頭)', { who: roleLabel('cmd') });
  renderActions(); renderTrainer();
}
function handleVoice(raw) {
  if (!SIM || SIM.ended) return;
  raw = String(raw).trim(); if (!raw) return;
  const t = raw.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  addLog('say', raw, { who: '口頭指示' });
  if (SIM.phase === 'dispatch') {
    if (SIM.announced && /現着|到着|着きました/.test(t)) arrive();
    else if (!SIM.announced && /出場|指令|出動/.test(t)) doDispatch();
    else speak('指令を聞いてから、現着を宣言してください。', 'fb');
    return;
  }
  if (/リピート|もう一度言|もういちど|繰り返し/.test(t)) { act('repeat'); return; }
  const { hits, rest } = parseCommands(t);
  const men = roleMentions(t);
  let ids = [];
  hits.forEach(h => h.ids.forEach(id => { if (!ids.some(x => x.id === id)) ids.push({ id, pos: h.pos }); }));
  if (ids.some(x => x.id === 't_pos_shock')) ids = ids.filter(x => x.id !== 't_pos_supine');
  const qa = ids.some(x => x.id === 'c_history') ? [] : QA.filter(([, , re]) => re.test(rest));
  if (!ids.length && !qa.length) {
    addLog('fb', '聞き取れませんでした：「' + raw + '」', { who: 'システム', lv: 'caution' });
    speak('隊員、もう一度お願いします。', 'monitor'); return;
  }
  const names = [...new Set(ids.filter(x => ACT[x.id].role !== 'cmd').map(x => ROLES[ACT[x.id].role].name))];
  if (names.length) speak(names.join('、') + '、了解。', 'monitor');
  let last = null;
  ids.forEach(({ id, pos }) => {
    if (SIM.ended) return;
    const a = ACT[id];
    const mention = [...men].reverse().find(m => m.pos < pos);
    if (mention && mention.role !== 'cmd' && a.role !== 'cmd' && mention.role !== a.role) {
      addLog('fb', ROLES[mention.role].name + 'への指示ですが「' + a.label + '」は' + ROLES[a.role].name + 'の担当です(代わりに実施)。', { who: '指導(参考)', lv: 'caution' });
    }
    run(id, { prefix: a.role !== last }); last = a.role;
  });
  if (qa.length) askHistory(qa);
}
function setMicUI() {
  const b = $('#micBtn'), st = $('#micState'); if (!b) return;
  b.textContent = listening ? '⏹ 聞き取り中…(タップで中止)' : '🎤 話す';
  b.classList.toggle('on', listening);
  st.textContent = !SR ? '音声認識に未対応のブラウザです(Safari/Chromeを使用)' : listening ? '話してください' : '';
}
function startListen() {
  if (!SR || listening || speakingN > 0 || !SIM || SIM.ended || screen !== 'sim') return;
  try {
    rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = e => {
      let interim = '', fin = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) fin += r[0].transcript; else interim += r[0].transcript; }
      const tr = $('#transcript'); if (tr) tr.textContent = '🎙 ' + (fin || interim);
      if (fin) handleVoice(fin);
    };
    rec.onend = () => { listening = false; setMicUI(); if (autoListen && speakingN === 0) setTimeout(startListen, 300); };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        autoListen = false; const c = $('#autoChk'); if (c) c.checked = false;
        const tr = $('#transcript'); if (tr) tr.textContent = '⚠ マイクの使用が許可されていません。ブラウザ/システムの設定でマイクと音声入力(Siri/音声入力)を許可してください。';
      }
    };
    rec.start(); listening = true;
  } catch (e) { listening = false; }
  setMicUI();
}
function abortListen() { try { if (rec) rec.abort(); } catch (e) { /* ignore */ } listening = false; setMicUI(); }
function initVoiceBar() {
  const mic = $('#micBtn'); if (!mic) return;
  const ac = $('#autoChk'); ac.checked = autoListen;
  mic.onclick = () => { if (listening) { autoListen = false; ac.checked = false; abortListen(); } else { stopSpeech(); startListen(); } };
  ac.onchange = () => { autoListen = ac.checked; if (autoListen) { stopSpeech(); startListen(); } else abortListen(); };
  const send = () => { const i = $('#cmdInput'); const v = i.value.trim(); if (v) { i.value = ''; handleVoice(v); } };
  $('#cmdSend').onclick = send; $('#cmdInput').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) send(); };
  if (!SR) mic.disabled = true;
  setMicUI();
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
