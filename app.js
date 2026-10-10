(function () {
  'use strict';

  // Код психолога: открывает все уровни и «Мой голос» сразу. Можно поменять здесь
  const PSY_CODE = 'взрослая';
  const GUIDE_URL = 'https://shtemenko-t.github.io/rvr?from=app';
  const SITE_URL = 'https://shtemenko-t.github.io/';
  const PASS_PCT = 70;
  const PASS_RUNS = 3;
  const MIN_ELIGIBLE = 5;
  const KEY = 'ta-trener-v1';

  // ---------- Хранилище ----------
  function fresh() {
    return { runs: { 1: [], 2: [], 3: [], 4: [] }, seen: {}, hooks: {}, lastBackup: 0, backupSnooze: 0, code: false, diary: [], introSeen: false, installHidden: false };
  }
  let st = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) st = Object.assign(fresh(), JSON.parse(raw));
  } catch (e) {}
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
  }

  // ---------- Помощники ----------
  const app = document.getElementById('app');
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = s => String(s).trim().toLowerCase().replace(/ё/g, 'е');
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const fmtDate = ts => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

  let genRe = null;
  try {
    const alts = GENERALIZATIONS.slice().sort((a, b) => b.length - a.length)
      .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    genRe = new RegExp('(^|[^\\p{L}])(' + alts + ')(?![\\p{L}])', 'giu');
  } catch (e) { genRe = null; }
  function highlight(text) {
    let found = 0;
    let html = esc(text);
    if (genRe) html = html.replace(genRe, (m, pre, w) => { found++; return pre + '<mark>' + w + '</mark>'; });
    return { html: html.replace(/\n/g, '<br>'), found };
  }

  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- Резервная копия ----------
  const DAY = 24 * 60 * 60 * 1000;
  const totalRuns = () => [1, 2, 3, 4].reduce((s, n) => s + runsOf(n).length, 0);
  const hasData = () => st.diary.length > 0 || totalRuns() >= 3;
  const backupDue = () => hasData() && Date.now() - (st.lastBackup || 0) > 14 * DAY && Date.now() > (st.backupSnooze || 0);
  const lastBackupText = () => st.lastBackup ? 'Последняя копия: ' + fmtDate(st.lastBackup) : 'Копия ещё не сохранялась';
  function saveFile(name, text, type, title) {
    const blob = new Blob([text], { type });
    try {
      const file = new File([blob], name, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title }).catch(() => {});
        return;
      }
    } catch (e) {}
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportBackup() {
    st.lastBackup = Date.now();
    save();
    const data = JSON.stringify({ app: 'ta-trener', version: 1, date: st.lastBackup, state: st }, null, 1);
    saveFile('trener-kopiya-' + new Date().toISOString().slice(0, 10) + '.json', data, 'application/json', 'Копия тренажёра');
    render();
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let obj = null;
      try { obj = JSON.parse(reader.result); } catch (e) {}
      if (!obj || obj.app !== 'ta-trener' || !obj.state || !obj.state.runs) { toast('Это не копия тренажёра'); return; }
      if (!confirm('Заменить данные на телефоне данными из копии от ' + fmtDate(obj.date) + '?')) return;
      st = Object.assign(fresh(), obj.state);
      save();
      go('home');
      toast('Данные восстановлены');
    };
    reader.readAsText(file);
  }

  // ---------- Прогресс ----------
  const runsOf = n => st.runs[n] || [];
  function passed(n) {
    const r = runsOf(n);
    if (r.length < PASS_RUNS) return false;
    const last = r[r.length - 1];
    return last.eligible >= MIN_ELIGIBLE && last.pct >= PASS_PCT;
  }
  const unlocked = n => n === 1 || st.code || passed(n - 1);
  const voiceUnlocked = () => st.code || passed(4);
  const theoryUnlocked = lvl => lvl === 0 || (lvl === 5 ? voiceUnlocked() : unlocked(lvl));

  // ---------- Крючки на гайд ----------
  // Не больше одного на экране итогов. Закрытый или открытый крючок больше не показывается
  const HOOKS = {
    parent: 'Заметила, что чаще всего ошибаешься на Родителе? Откуда он берётся и как с ним договориться — разбираю в гайде',
    conflict: 'Почему в ссорах с близкими включается Ребёнок, а внутренний критик говорит голосом родителей — подробно в гайде',
    first: 'Распознавать — первый шаг. Как выходить из привычных сценариев в общении — в гайде «Родитель, Взрослый, Ребёнок»'
  };
  const hookOpen = id => !(st.hooks && st.hooks[id]);
  function closeHook(id) { st.hooks = st.hooks || {}; st.hooks[id] = true; save(); }
  function pickHook(results, lvl) {
    const wrong = results.filter(r => r.kind === 'choice' && r.correct === false);
    const parentWrong = wrong.filter(r => /Родитель/.test(r.right) || /Родитель/.test(r.picked));
    if (hookOpen('parent') && parentWrong.length >= 2 && parentWrong.length * 2 >= wrong.length) return 'parent';
    if (hookOpen('conflict') && (lvl === 3 || lvl === 4)) return 'conflict';
    if (hookOpen('first')) return 'first';
    return null;
  }
  const hookCard = id => '<aside class="hook"><button class="hook-x" data-act="hook-close" data-hook="' + id + '" aria-label="Скрыть">×</button>' +
    '<p>' + esc(HOOKS[id]) + '</p><a class="btn ghost small-btn" href="' + GUIDE_URL + '" target="_blank" rel="noopener" data-hook-link="' + id + '">Читать гайд</a></aside>';

  // ---------- Навигация ----------
  let view = 'home';
  let sess = null;
  let lastResult = null;
  function go(v) {
    view = v;
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    const views = { home, train, result, theory, voice, settings, guide };
    app.innerHTML = views[view]();
    if (view === 'voice') bindVoice();
  }

  const backBar = (title) =>
    '<div class="topbar"><button class="back" data-act="home" aria-label="На главную">←</button><span class="topbar-title">' + title + '</span></div>';

  // ---------- Главная ----------
  function home() {
    let h = '<header class="hero"><div class="eyebrow">Тренажёр эго-состояний</div>' +
      '<h1>Родитель, Взрослый, Ребёнок</h1>' +
      '<p class="sub">Учись слышать, из какого состояния звучит фраза, и отвечать иначе</p></header>';

    if (!st.introSeen) {
      const c = THEORY[0];
      h += '<section class="card intro"><h2>' + c.title + '</h2>' + c.html +
        '<button class="btn" data-act="intro">Понятно, начнём</button></section>';
    }

    if (!isStandalone() && !st.installHidden) {
      h += '<section class="note"><b>Добавь тренажёр на главный экран</b>' +
        '<p>В Safari нажми «Поделиться», затем «На экран „Домой“». Так он работает без интернета, а записи надёжнее хранятся на телефоне</p>' +
        '<button class="link" data-act="hide-install">Скрыть</button></section>';
    }

    if (backupDue()) {
      h += '<section class="note backup-note"><b>Пора сохранить копию</b>' +
        '<p>Прогресс и дневник хранятся только на этом телефоне. Копия поможет ничего не потерять</p>' +
        '<div class="row-btns"><button class="btn small-btn" data-act="backup">Сохранить копию</button>' +
        '<button class="link" data-act="snooze">Позже</button></div></section>';
    }

    h += '<div class="list">';
    LEVELS.forEach(L => {
      const open = unlocked(L.n);
      const r = runsOf(L.n);
      let status = '';
      if (!open) {
        status = 'Откроется после трёх тренировок уровня ' + (L.n - 1) + ', если в последней будет от ' + PASS_PCT + '% верных';
      } else if (passed(L.n)) {
        status = 'Пройден · тренировок: ' + r.length + ' · последняя ' + r[r.length - 1].pct + '%';
      } else if (r.length) {
        const last = r[r.length - 1];
        status = 'Тренировок: ' + r.length + ' · последняя ' + last.pct + '%';
        if (r.length >= PASS_RUNS) status += ' · для следующего уровня нужно от ' + PASS_PCT + '%';
      } else {
        status = 'Ещё не начат';
      }
      h += '<section class="level' + (open ? '' : ' locked') + '">' +
        '<div class="lvl-num">' + (open ? L.n : '🔒') + '</div>' +
        '<div class="lvl-body"><h3>' + L.title + '</h3><p class="muted">' + L.sub + '</p>' +
        '<p class="status">' + status + '</p>' +
        (open ? '<button class="btn" data-act="start" data-lvl="' + L.n + '">Тренироваться</button>' : '') +
        '</div></section>';
    });

    if (unlocked(2)) {
      h += '<section class="level mix"><div class="lvl-num">∞</div><div class="lvl-body"><h3>Всё вперемешку</h3>' +
        '<p class="muted">Задания из всех открытых уровней. На открытие уровней не влияет</p>' +
        '<button class="btn ghost" data-act="start" data-lvl="mix">Тренироваться</button></div></section>';
    }

    const vOpen = voiceUnlocked();
    h += '<section class="level voice-card' + (vOpen ? '' : ' locked') + '"><div class="lvl-num">' + (vOpen ? '✎' : '🔒') + '</div>' +
      '<div class="lvl-body"><h3>Мой голос</h3><p class="muted">Записывай свои мысли и переписывай их голосом Взрослой или Заботливой</p>' +
      (vOpen ? '<p class="status">Записей в дневнике: ' + st.diary.length + '</p><button class="btn" data-act="go" data-v="voice">Открыть</button>'
        : '<p class="status">Откроется после уровня 4</p>') +
      '</div></section></div>';

    h += '<nav class="bottom-links"><button class="btn ghost" data-act="go" data-v="theory">Теория</button>' +
      '<button class="btn ghost" data-act="go" data-v="settings">Настройки</button></nav>' +
      '<button class="deeper" data-act="go" data-v="guide">Хочу глубже: гайд «Родитель, Взрослый, Ребёнок» →</button>' +
      '<p class="local-line">Всё хранится только на этом телефоне. <button class="link" data-act="go" data-v="settings">Сохранить копию</button></p>';
    return h;
  }

  // ---------- Тренировка ----------
  function startSession(lvl) {
    const levels = lvl === 'mix' ? LEVELS.map(L => L.n).filter(unlocked) : [lvl];
    const pool = TASKS.filter(t => levels.indexOf(t.lvl) !== -1);
    // Сначала задания, которых ещё не было, потом уже знакомые
    const seen = (st.seen && st.seen[lvl]) || [];
    const fresh1 = list => shuffle(list.filter(t => seen.indexOf(t.id) === -1)).concat(shuffle(list.filter(t => seen.indexOf(t.id) !== -1)));
    const choice = fresh1(pool.filter(t => t.type === 'choice'));
    const other = fresh1(pool.filter(t => t.type !== 'choice')).slice(0, 2);
    const size = Math.min(pool.length, 8 + Math.floor(Math.random() * 3));
    const tasks = shuffle(other.concat(choice.slice(0, Math.max(0, size - other.length))));
    st.seen = st.seen || {};
    let nextSeen = seen.concat(tasks.map(t => t.id).filter(id => seen.indexOf(id) === -1));
    if (pool.every(t => nextSeen.indexOf(t.id) !== -1)) nextSeen = tasks.map(t => t.id);
    st.seen[lvl] = nextSeen;
    save();
    const orders = {};
    tasks.forEach(t => {
      if (t.type === 'choice') orders[t.id] = shuffle(t.opts.map((_, i) => i));
      if (t.type === 'match') orders[t.id] = shuffle(t.pairs.map(p => p[1]));
    });
    sess = { lvl, tasks, orders, i: 0, results: [], cur: fresh_cur() };
    go('train');
  }
  function fresh_cur() { return { answered: false, hinted: false, pick: null, text: '', picks: {}, correct: null }; }

  function train() {
    const t = sess.tasks[sess.i];
    const c = sess.cur;
    const total = sess.tasks.length;
    let h = '<div class="topbar"><button class="back" data-act="quit" aria-label="Выйти">×</button>' +
      '<span class="topbar-title">Задание ' + (sess.i + 1) + ' из ' + total + '</span></div>' +
      '<div class="progress"><span style="width:' + Math.round(sess.i / total * 100) + '%"></span></div>';

    h += '<section class="task">';
    if (t.type === 'choice') h += choiceView(t, c);
    else if (t.type === 'reform') h += reformView(t, c);
    else h += matchView(t, c);
    h += '</section>';
    return h;
  }

  const hintBtn = c => c.answered ? '' : '<button class="link hint" data-act="hint">' + (c.hinted ? 'Подсказка открыта' : 'Подсказка') + '</button>';
  const nextBtn = () => '<button class="btn next" data-act="next">' + (sess.i + 1 < sess.tasks.length ? 'Дальше' : 'Итоги') + '</button>';

  function phraseBlock(t) {
    let h = '';
    if (t.lines) h += '<div class="dialog">' + t.lines.map((l, i) => '<p><span class="ln">' + (i + 1) + '</span>' + esc(l) + '</p>').join('') + '</div>';
    if (t.text) h += '<p class="phrase">' + esc(t.text) + '</p>';
    if (t.note) h += '<p class="note-ctx">' + esc(t.note) + '</p>';
    return h;
  }

  function choiceView(t, c) {
    let h = '<div class="eyebrow">' + esc(t.q) + '</div>' + phraseBlock(t);
    const order = sess.orders[t.id];
    h += '<div class="opts">';
    order.forEach(i => {
      const o = t.opts[i];
      let cls = 'opt';
      if (c.answered) {
        if (o[2]) cls += ' ok';
        else if (c.pick === i) cls += ' no';
        else cls += ' dim';
      }
      h += '<button class="' + cls + '" data-act="pick" data-i="' + i + '"' + (c.answered ? ' disabled' : '') + '>' + esc(o[0]) + '</button>';
    });
    h += '</div>';
    if (c.answered) {
      const chosen = t.opts[c.pick];
      const right = t.opts.find(o => o[2]);
      h += '<div class="why ' + (chosen[2] ? 'ok' : 'no') + '"><b>' + (chosen[2] ? 'Да.' : 'Не совсем.') + '</b> ' + esc(chosen[1]) + '</div>';
      if (!chosen[2]) h += '<div class="why ok"><b>Верно: ' + esc(right[0]) + '.</b> ' + esc(right[1]) + '</div>';
      if (t.star) h += '<p class="star">*' + esc(STAR) + '</p>';
      h += nextBtn();
    } else {
      h += hintBtn(c);
    }
    return h;
  }

  function reformView(t, c) {
    let h = '<div class="eyebrow">Переформулируй из ' + esc(t.from) + (/^[ВвФф]/.test(t.to) ? ' во ' : ' в ') + esc(t.to) + '</div>' + phraseBlock(t);
    if (!c.answered) {
      h += '<label class="field"><span>Твой вариант</span><textarea id="reform-text" rows="4" placeholder="Напиши, как это сказать иначе">' + esc(c.text) + '</textarea></label>' +
        '<button class="btn" data-act="reform-check">Проверить себя</button>' + hintBtn(c);
      return h;
    }
    const hl = highlight(c.text);
    h += '<div class="mine"><div class="label">Твой вариант</div><p>' + hl.html + '</p></div>';
    h += '<p class="muted small">' + (hl.found ? 'Подсвечены слова-обобщения. Проверь, нужны ли они здесь' : 'Слов-обобщений не нашлось') + '</p>';
    h += '<div class="checklist"><div class="label">Проверь себя</div>' +
      CHECKLISTS[t.voice].map((x, i) => '<label class="check"><input type="checkbox"><span>' + esc(x) + '</span></label>').join('') + '</div>';
    h += '<div class="refs"><div class="label">Как ещё можно сказать</div>' + t.refs.map(r => '<p>' + esc(r) + '</p>').join('') + '</div>';
    h += '<p class="muted small">Переформулировки не идут в процент: тут важна не оценка, а практика</p>';
    h += nextBtn();
    return h;
  }

  function matchView(t, c) {
    const states = sess.orders[t.id];
    let h = '<div class="eyebrow">Одна ситуация в пяти состояниях</div><p class="phrase plain">' + esc(t.text) + '</p><div class="match">';
    t.pairs.forEach((p, i) => {
      const pick = c.picks[i] || '';
      let cls = 'mrow';
      if (c.answered) cls += pick === p[1] ? ' ok' : ' no';
      h += '<div class="' + cls + '"><p>' + esc(p[0]) + '</p>';
      if (!c.answered) {
        h += '<select data-row="' + i + '"><option value="">Выбери состояние</option>' +
          states.map(s => '<option' + (s === pick ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>';
      } else {
        h += '<div class="mres">' + (pick === p[1] ? '✓ ' + esc(p[1]) : '✗ ' + esc(pick) + '<br><b>Верно: ' + esc(p[1]) + '</b>') + '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
    if (!c.answered) h += '<button class="btn" data-act="match-check">Проверить</button>' + hintBtn(c);
    else {
      h += '<div class="why ' + (c.correct ? 'ok' : 'no') + '">' + (c.correct ? '<b>Всё верно.</b> Одна и та же ситуация, а ответить можно из любого состояния' :
        '<b>Есть ошибки.</b> Задание засчитывается, только когда верны все пять фраз') + '</div>';
      h += nextBtn();
    }
    return h;
  }

  function finishTask(kind, correct) {
    sess.cur.answered = true;
    sess.cur.correct = correct;
    const t = sess.tasks[sess.i];
    const rec = { id: t.id, kind, correct, hinted: sess.cur.hinted };
    if (kind === 'choice') { rec.picked = t.opts[sess.cur.pick][0]; rec.right = t.opts.find(o => o[2])[0]; }
    sess.results.push(rec);
    render();
  }

  function next() {
    if (sess.i + 1 < sess.tasks.length) {
      sess.i++;
      sess.cur = fresh_cur();
      go('train');
    } else {
      finishSession();
    }
  }

  function finishSession() {
    const scored = sess.results.filter(r => r.kind !== 'reform');
    const eligible = scored.filter(r => !r.hinted);
    const correct = eligible.filter(r => r.correct).length;
    const pct = eligible.length ? Math.round(correct / eligible.length * 100) : 0;
    const before = { lv: [2, 3, 4].map(unlocked), v: voiceUnlocked() };
    if (sess.lvl !== 'mix') {
      st.runs[sess.lvl] = runsOf(sess.lvl).concat([{ pct, eligible: eligible.length, date: Date.now() }]);
      save();
    }
    const opened = [];
    [2, 3, 4].forEach((n, i) => { if (!before.lv[i] && unlocked(n)) opened.push('Открыт уровень ' + n + ': «' + LEVELS[n - 1].title + '» и новые карточки теории'); });
    if (!before.v && voiceUnlocked()) opened.push('Открыт «Мой голос»: дневник, где ты переписываешь свои мысли');
    lastResult = {
      lvl: sess.lvl, pct, correct, eligible: eligible.length,
      hinted: scored.length - eligible.length,
      reforms: sess.results.filter(r => r.kind === 'reform').length,
      opened,
      hook: pickHook(sess.results, sess.lvl)
    };
    go('result');
  }

  function result() {
    const r = lastResult;
    let h = '<section class="result"><div class="eyebrow">' + (r.lvl === 'mix' ? 'Всё вперемешку' : 'Уровень ' + r.lvl) + '</div>' +
      '<div class="big">' + r.pct + '%</div>' +
      '<p>Верно ' + r.correct + ' из ' + r.eligible + ' без подсказки</p>';
    if (r.hinted) h += '<p class="muted small">С подсказкой: ' + r.hinted + '. Они засчитаны, но в процент не входят</p>';
    if (r.reforms) h += '<p class="muted small">Переформулировок: ' + r.reforms + '</p>';

    if (r.lvl !== 'mix') {
      const runs = runsOf(r.lvl).length;
      let msg;
      if (r.eligible < MIN_ELIGIBLE) msg = 'Чтобы тренировка засчиталась для открытия уровня, нужно хотя бы ' + MIN_ELIGIBLE + ' заданий с выбором без подсказки';
      else if (r.pct >= PASS_PCT && runs >= PASS_RUNS) msg = 'Уровень пройден. Можно двигаться дальше или закрепить ещё раз';
      else if (r.pct >= PASS_PCT) msg = 'Хороший результат. Тренировок на этом уровне: ' + runs + ' из ' + PASS_RUNS;
      else msg = 'Для следующего уровня нужно от ' + PASS_PCT + '%. Перечитай пояснения к ошибкам, и всё получится';
      h += '<p class="msg">' + msg + '</p>';
    }
    r.opened.forEach(o => { h += '<div class="opened">' + esc(o) + '</div>'; });

    if (r.hook && hookOpen(r.hook)) h += hookCard(r.hook);
    h += '<div class="actions"><button class="btn" data-act="start" data-lvl="' + r.lvl + '">Ещё тренировка</button>' +
      '<button class="btn ghost" data-act="home">На главную</button></div></section>';
    return h;
  }

  // ---------- Теория ----------
  function cardHtml(c) { return '<details class="tcard"><summary>' + esc(c.title) + '</summary><div class="tbody">' + c.html + '</div></details>'; }
  function theory() {
    let h = backBar('Теория');
    const groups = [[0, 'Начало'], [1, 'Уровень 1'], [2, 'Уровень 2'], [3, 'Уровень 3'], [4, 'Уровень 4'], [5, 'Мой голос']];
    groups.forEach(([lvl, name]) => {
      const cards = THEORY.filter(c => c.lvl === lvl);
      h += '<h2 class="group">' + name + '</h2>';
      if (theoryUnlocked(lvl)) h += cards.map(cardHtml).join('');
      else h += '<p class="muted small locked-line">🔒 Откроется вместе с ' + (lvl === 5 ? '«Моим голосом»' : 'уровнем ' + lvl) + '</p>';
    });
    h += '<button class="deeper" data-act="go" data-v="guide">Хочу глубже: гайд «Родитель, Взрослый, Ребёнок» →</button>';
    return h;
  }

  function openHint() {
    const t = sess.tasks[sess.i];
    sess.cur.hinted = true;
    const cards = THEORY.filter(c => c.lvl === t.lvl);
    const sheet = document.getElementById('sheet');
    sheet.querySelector('.sheet-body').innerHTML = '<p class="muted small">Задание засчитается, но не войдёт в процент</p>' +
      cards.map(c => '<div class="hcard"><h3>' + esc(c.title) + '</h3>' + c.html + '</div>').join('');
    sheet.classList.add('open');
    const hb = app.querySelector('.hint');
    if (hb) hb.textContent = 'Подсказка открыта';
  }

  // ---------- Мой голос ----------
  const VOICES = {
    adult: { name: 'Взрослая', q: 'Что произошло на самом деле, если убрать оценки?' },
    care: { name: 'Заботливая', q: 'Что сказала бы любящая и мудрая женщина, если бы рядом была ты?' }
  };
  function voice() {
    let h = backBar('Мой голос');
    h += '<p class="lead">Запиши мысль, отметь, из какого она состояния, и перепиши её голосом Взрослой или Заботливой. Записи можно показать психологу на сессии</p>';
    h += cardHtml(THEORY.find(c => c.lvl === 5));
    h += '<section class="form">' +
      '<label class="field"><span>1. Мысль, как она прозвучала в голове</span><textarea id="v-thought" rows="3" placeholder="Например: опять я всё завалила"></textarea></label>' +
      '<div id="v-preview" class="preview"></div>' +
      '<div class="field"><span>2. Из какого она состояния?</span><div class="chips" data-group="state">' +
      DIARY_STATES.map(s => '<button class="chip" data-val="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div></div>' +
      '<div class="field"><span>3. Чьим голосом отвечаешь?</span><div class="chips" data-group="voice">' +
      Object.keys(VOICES).map(k => '<button class="chip' + (k === 'adult' ? ' on' : '') + '" data-val="' + k + '">' + VOICES[k].name + '</button>').join('') + '</div></div>' +
      '<label class="field"><span>4. Перепиши</span><p class="muted small" id="v-q">' + VOICES.adult.q + '</p><textarea id="v-rewrite" rows="4"></textarea></label>' +
      '<div class="checklist" id="v-check"></div>' +
      '<button class="btn" id="v-save">Сохранить в дневник</button></section>';

    h += '<h2 class="group">Дневник</h2>';
    if (!st.diary.length) {
      h += '<p class="muted">Здесь появятся твои записи</p>';
    } else {
      h += '<div class="export"><button class="btn ghost" data-act="copy">Скопировать текст</button><button class="btn ghost" data-act="file">Сохранить файл</button></div>' +
        '<p class="muted small">Записи хранятся только на этом телефоне. «Скопировать текст» и «Сохранить файл» — чтобы показать их психологу. Чтобы ничего не потерять, сохраняй полную копию в настройках. ' + lastBackupText() + '</p>';
      st.diary.slice().reverse().forEach(e => {
        h += '<article class="entry"><div class="date">' + fmtDate(e.date) + '</div>' +
          '<p class="e-thought">' + highlight(e.thought).html + '</p>' +
          '<p class="muted small">' + esc(e.state || 'Состояние не отмечено') + '</p>' +
          '<div class="e-voice"><div class="label">Голос ' + (e.voice === 'care' ? 'Заботливой' : 'Взрослой') + '</div><p>' + esc(e.rewrite).replace(/\n/g, '<br>') + '</p></div>' +
          '<button class="link del" data-act="del" data-id="' + e.id + '">Удалить</button></article>';
      });
    }
    return h;
  }

  function bindVoice() {
    const th = document.getElementById('v-thought');
    const pv = document.getElementById('v-preview');
    const vq = document.getElementById('v-q');
    const chk = document.getElementById('v-check');
    const setCheck = v => {
      chk.innerHTML = '<div class="label">Проверь себя</div>' + CHECKLISTS[v].map(x => '<label class="check"><input type="checkbox"><span>' + esc(x) + '</span></label>').join('');
      vq.textContent = VOICES[v].q;
    };
    setCheck('adult');
    th.addEventListener('input', () => {
      const hl = highlight(th.value);
      pv.innerHTML = hl.found ? '<span class="muted small">Слова-обобщения: </span>' + hl.html : '';
    });
    app.querySelectorAll('.chips').forEach(g => {
      g.addEventListener('click', e => {
        const b = e.target.closest('.chip');
        if (!b) return;
        e.preventDefault();
        g.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        if (g.dataset.group === 'voice') setCheck(b.dataset.val);
      });
    });
    document.getElementById('v-save').addEventListener('click', () => {
      const thought = th.value.trim();
      const rewrite = document.getElementById('v-rewrite').value.trim();
      if (!thought || !rewrite) { toast('Заполни мысль и новую версию'); return; }
      const sOn = app.querySelector('[data-group="state"] .on');
      const vOn = app.querySelector('[data-group="voice"] .on');
      st.diary.push({ id: Date.now(), date: Date.now(), thought, state: sOn ? sOn.dataset.val : '', voice: vOn ? vOn.dataset.val : 'adult', rewrite });
      save();
      render();
      toast('Сохранено в дневник');
    });
  }

  function diaryText() {
    let s = 'Дневник «Мой голос»\n\n';
    st.diary.forEach(e => {
      s += fmtDate(e.date) + '\n' +
        'Мысль: ' + e.thought + '\n' +
        'Состояние: ' + (e.state || 'не отмечено') + '\n' +
        'Голос ' + (e.voice === 'care' ? 'Заботливой' : 'Взрослой') + ': ' + e.rewrite + '\n\n';
    });
    return s;
  }
  function copyDiary() {
    const text = diaryText();
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('Текст скопирован'); } catch (e) { toast('Не получилось скопировать'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Текст скопирован'), fallback);
    else fallback();
  }
  function fileDiary() {
    saveFile('moy-golos-' + new Date().toISOString().slice(0, 10) + '.txt', diaryText(), 'text/plain', 'Дневник «Мой голос»');
  }

  // ---------- О гайде ----------
  function guide() {
    let h = backBar('Хочу глубже');
    h += '<section class="card guide-card"><div class="eyebrow">Гайд-практикум · PDF</div><h2>Родитель, Взрослый, Ребёнок</h2>' +
      '<p>Тренажёр учит узнавать состояния. Гайд объясняет, почему они включаются и что с этим делать</p>' +
      '<p>В гайде — эго-состояния, транзакции, треугольник Карпмана и работа с внутренним критиком. С примерами из жизни и упражнениями</p>' +
      '<a class="btn" href="' + GUIDE_URL + '" target="_blank" rel="noopener">Читать гайд</a></section>';
    return h;
  }

  // ---------- Настройки ----------
  function settings() {
    let h = backBar('Настройки');
    h += '<section class="card"><h2>Твои данные</h2>' +
      '<p>Всё, что ты делаешь в тренажёре, хранится только на этом телефоне: прогресс по уровням, дневник «Мой голос» и настройки. Никуда не отправляется, и никто, включая меня, этого не видит</p>' +
      '<p>Поэтому данные могут пропасть, если удалить тренажёр с экрана «Домой», очистить историю и данные Safari, сменить телефон или долго не открывать тренажёр. Раз в пару недель сохраняй копию в «Файлы» или в заметки, а на новом телефоне восстанови её</p>' +
      '<p class="muted small">' + lastBackupText() + '</p>' +
      '<div class="row-btns"><button class="btn" data-act="backup">Сохранить копию</button>' +
      '<button class="btn ghost" data-act="restore">Восстановить из копии</button></div>' +
      '<input type="file" id="restore-file" accept="application/json,.json" hidden></section>';

    h += '<section class="card"><h2>Код психолога</h2>';
    if (st.code) h += '<p>Код введён: все уровни и «Мой голос» открыты</p>';
    else h += '<p class="muted">Если психолог дала тебе код, введи его здесь, и все режимы откроются сразу</p>' +
      '<div class="row"><input id="code" type="text" autocomplete="off" autocapitalize="off" placeholder="Код"><button class="btn" data-act="code">Открыть</button></div>';
    h += '</section>';

    h += '<section class="card"><h2>Как установить на iPhone</h2><p>Открой тренажёр в Safari, нажми «Поделиться», затем «На экран „Домой“». Так он работает без интернета, и данные хранятся надёжнее, чем во вкладке браузера</p></section>';

    h += '<section class="card"><h2>Начать заново</h2><p class="muted">Сбросит прогресс тренировок. Дневник «Мой голос» останется</p>' +
      '<button class="btn ghost danger" data-act="reset">Сбросить прогресс</button></section>';

    h += '<section class="card"><h2>Об авторе</h2><p>Тренажёр сделан к гайду <a href="' + GUIDE_URL + '" target="_blank" rel="noopener">«Родитель, Взрослый, Ребёнок»</a>. Автор — психолог <a href="' + SITE_URL + '" target="_blank" rel="noopener">Таисия Штеменко</a></p></section>';
    return h;
  }

  // ---------- События ----------
  app.addEventListener('click', e => {
    const hl = e.target.closest('[data-hook-link]');
    if (hl) closeHook(hl.dataset.hookLink);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'home') go('home');
    else if (act === 'go') go(b.dataset.v);
    else if (act === 'intro') { st.introSeen = true; save(); render(); }
    else if (act === 'hide-install') { st.installHidden = true; save(); render(); }
    else if (act === 'start') startSession(b.dataset.lvl === 'mix' ? 'mix' : Number(b.dataset.lvl));
    else if (act === 'quit') { if (confirm('Выйти из тренировки? Она не сохранится')) { sess = null; go('home'); } }
    else if (act === 'hint') openHint();
    else if (act === 'pick') {
      const t = sess.tasks[sess.i];
      const i = Number(b.dataset.i);
      sess.cur.pick = i;
      finishTask('choice', !!t.opts[i][2]);
    }
    else if (act === 'reform-check') {
      const v = document.getElementById('reform-text').value.trim();
      if (!v) { toast('Сначала напиши свой вариант'); return; }
      sess.cur.text = v;
      finishTask('reform', null);
    }
    else if (act === 'match-check') {
      const t = sess.tasks[sess.i];
      const picks = {};
      let all = true;
      app.querySelectorAll('.match select').forEach(s => { picks[s.dataset.row] = s.value; if (!s.value) all = false; });
      if (!all) { toast('Выбери состояние для каждой фразы'); return; }
      sess.cur.picks = picks;
      finishTask('match', t.pairs.every((p, i) => picks[i] === p[1]));
    }
    else if (act === 'next') next();
    else if (act === 'backup') exportBackup();
    else if (act === 'snooze') { st.backupSnooze = Date.now() + 7 * DAY; save(); render(); }
    else if (act === 'restore') { const f = document.getElementById('restore-file'); if (f) f.click(); }
    else if (act === 'hook-close') { closeHook(b.dataset.hook); const card = b.closest('.hook'); if (card) card.remove(); }
    else if (act === 'copy') copyDiary();
    else if (act === 'file') fileDiary();
    else if (act === 'del') {
      if (confirm('Удалить эту запись?')) { st.diary = st.diary.filter(x => String(x.id) !== b.dataset.id); save(); render(); }
    }
    else if (act === 'code') {
      const v = document.getElementById('code').value;
      if (norm(v) === norm(PSY_CODE)) { st.code = true; save(); render(); toast('Все режимы открыты'); }
      else toast('Код не подошёл');
    }
    else if (act === 'reset') {
      if (confirm('Сбросить прогресс тренировок?')) { st.runs = fresh().runs; save(); toast('Прогресс сброшен'); go('home'); }
    }
  });

  app.addEventListener('change', e => {
    if (e.target.id === 'restore-file' && e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
  });

  document.getElementById('sheet').addEventListener('click', e => {
    if (e.target.closest('[data-close]') || e.target.id === 'sheet') document.getElementById('sheet').classList.remove('open');
  });

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
