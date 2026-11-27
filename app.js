/* AutofillSMARTMED — LIFF app (หน้าเดียว, ?p=หน้า) */
(function () {
  'use strict';
  const C = window.APP_CONFIG, O = window.OPT;
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const S = { me: null, dash: null, idToken: '', uid: '', ready: null };

  // ------------------------------------------------------------ helpers
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const be = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]} ${TH_M[+m[2] - 1]} ${String(+m[1] + 543).slice(2)}` : '—'; };
  const range = (a, b) => (a && b && a !== b) ? `${be(a)} – ${be(b)}` : be(a || b);
  const optText = (list, v) => { const o = (list || []).find(x => x.value === v); return o ? o.text : (v || ''); };
  const options = (list, sel, blank) => (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
    list.map(o => `<option value="${esc(o.value)}"${o.value === sel ? ' selected' : ''}>${esc(o.text)}</option>`).join('');
  const params = () => Object.fromEntries(new URLSearchParams(location.search));
  const ADVISORS = new Set(O.advisors);
  const STATUS_BADGE = { pending_slip: 'warn', slip_review: 'warn', paid: '', in_progress: '', done: 'ok', cancelled: 'gray' };
  const ACTIVE = ['pending_slip', 'slip_review', 'paid', 'in_progress'];
  const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };

  let toastT;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 4500 : 2200);
  }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.innerHTML; btn.innerHTML = '<i class="fas fa-circle-notch spin"></i> กำลังบันทึก'; } else if (btn.dataset.t) btn.innerHTML = btn.dataset.t; }

  const READS = ['me', 'boot', 'dashboard', 'getEmrDraft', 'adminOrders', 'adminOrderDetail', 'adminSlip', 'adminCred'];
  let mutSeq = 0;
  async function api(action, data) {
    await S.ready;   // หน้าที่แสดงจากแคชก่อน LIFF พร้อม จะรอ token ตรงนี้
    if (READS.indexOf(action) < 0) mutSeq++;
    const res = await fetch(C.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, idToken: S.idToken }, data || {})),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
    return j.data;
  }
  // ---- แคชข้อมูล: แสดงของเดิมทันที แล้วดึงใหม่เบื้องหลัง (เก็บใน localStorage ของเครื่องผู้ใช้เอง)
  const CK = uid => 'smd:v1:' + uid;
  function saveCache() { if (S.uid && S.me) store.set(CK(S.uid), JSON.stringify({ me: S.me, dash: S.dash })); }
  function readCache(uid) { try { return JSON.parse(store.get(CK(uid), 'null')); } catch (e) { return null; } }
  let dashAt = 0, dashP = null, viewSeq = 0;
  function setDash(d) { S.dash = d; dashAt = Date.now(); saveCache(); }
  function fetchDash() {
    if (!dashP) {
      const m = mutSeq;
      dashP = api('dashboard').then(d => {
        if (m === mutSeq) setDash(d); else dashAt = 0;   // มีการแก้ข้อมูลระหว่างโหลด → ข้อมูลชุดนี้อาจเก่า ไม่ทับ
        return S.dash || d;
      }).finally(() => { dashP = null; });
    }
    return dashP;
  }
  async function loadDash() { return fetchDash(); }
  /** ใช้ข้อมูลที่มีอยู่ทันที ถ้าเก่ากว่า 15 วิ ค่อยดึงใหม่เบื้องหลัง */
  async function dash() {
    if (S.dash) { if (Date.now() - dashAt > 15000) bgRefresh(); return S.dash; }
    return fetchDash();
  }
  function bgRefresh() {
    const before = JSON.stringify(S.dash), seq = viewSeq;
    fetchDash().then(() => { if (JSON.stringify(S.dash) !== before) quietRerender(seq); }).catch(() => {});
  }
  /** วาดหน้าเดิมใหม่เงียบ ๆ เฉพาะหน้าที่เป็นรายการ (ไม่ทับฟอร์มที่กำลังกรอก) */
  function quietRerender(seq) {
    if (seq !== viewSeq) return;
    const p = params(), page = p.p || 'home';
    if (!(page === 'home' || page === 'cases' || (page === 'order' && p.o))) return;
    const y = window.scrollY;
    render(true).then(() => window.scrollTo(0, y));
  }
  function recalcMissing() {
    const bm = {};
    S.dash.blocks.forEach(b => { bm[b.blockId] = b; });
    S.dash.cases.forEach(c => { c.missing = bm[c.blockId] ? missing(c, bm[c.blockId]) : ['ไม่พบบล็อก']; });
  }
  /** แก้ข้อมูลในเครื่องตามผลที่เซิร์ฟเวอร์ตอบ — ไม่ต้องรอโหลดทั้งหมดใหม่ */
  function patchDash(fn) {
    if (!S.dash) return;
    fn(S.dash); recalcMissing(); saveCache(); dashAt = 0;   // ครั้งหน้าที่เปิดหน้ารายการจะดึงของจริงเบื้องหลัง
  }
  const upsert = (arr, key, o) => { const i = arr.findIndex(x => x[key] === o[key]); if (i >= 0) arr[i] = Object.assign({}, arr[i], o); else arr.push(o); };
  const ST_TH = { pending_slip: 'รอชำระเงิน / ส่งสลิป', slip_review: 'รอตรวจสลิป', paid: 'ชำระแล้ว รอคิวกรอก', in_progress: 'กำลังกรอก', done: 'กรอกเสร็จแล้ว', cancelled: 'ยกเลิก' };
  // โหลดไฟล์ที่ใช้เฉพาะบางหน้า (ICD แนะนำ, QR) เมื่อจำเป็น
  const libs = {};
  function lib(src) {
    if (!libs[src]) libs[src] = new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = src + '?v=4'; sc.charset = 'utf-8'; sc.onload = ok; sc.onerror = () => { delete libs[src]; bad(new Error('โหลดไฟล์ไม่สำเร็จ ลองใหม่')); }; document.head.appendChild(sc); });
    return libs[src];
  }
  const showWho = () => { $('#who').textContent = S.me && S.me.user ? S.me.user.fullName.split(' ')[0] : ''; };
  const blockById = id => (S.dash && S.dash.blocks.find(b => b.blockId === id)) || null;
  const activeBlocks = () => (S.dash ? S.dash.blocks.filter(b => b.archived !== '1') : []).slice().reverse();

  // กฎความครบ — ต้องตรงกับ missing_() ใน Code.gs
  const BLOCK_REQ = { course: 'รายวิชา', rotStart: 'วันเริ่ม rotation', rotEnd: 'วันจบ rotation', site: 'สถานที่' };
  const CASE_REQ = { ptType: 'ประเภทผู้ป่วย', hn: 'HN', careStart: 'วันเริ่มดูแล', careEnd: 'วันสิ้นสุดดูแล', diagnosis: 'Diagnosis', icd10: 'ICD-10', diseaseGroup: 'กลุ่มโรค', setting: 'Clinical setting', category: 'Category', complexity: 'Complexity', advisor: 'อาจารย์', detail: 'รายละเอียด' };
  function missing(c, b) {
    const out = [];
    Object.keys(BLOCK_REQ).forEach(k => { if (!b[k]) out.push(BLOCK_REQ[k] + ' (บล็อก)'); });
    const e = Object.assign({}, c, { setting: c.setting || b.setting, category: c.category || b.category, complexity: c.complexity || b.complexity, advisor: c.advisor || b.advisor, detail: c.detail || b.detail || '-' });
    Object.keys(CASE_REQ).forEach(k => { if (!e[k]) out.push(CASE_REQ[k]); });
    if (e.careStart && e.careEnd && e.careStart > e.careEnd) out.push('วันเริ่มดูแลอยู่หลังวันสิ้นสุด');
    if (b.rotStart && b.rotEnd && b.rotStart > b.rotEnd) out.push('วันเริ่ม rotation อยู่หลังวันจบ (บล็อก)');
    return out;
  }
  const SETTING_BY_CODE = [[/^อย/, 'Medicine'], [/^ศธ/, 'Orthopedics'], [/^ศศ/, 'Surgery'], [/^กม/, 'Pediatrics'], [/^สน/, 'OB GYN'], [/^จษ/, 'Eye'], [/^สล/, 'ENT'], [/^วฟ/, 'Rehabilitation'], [/^พศก58/, 'Family Medicine'], [/^จว/, 'Psychiatry'], [/^ฉก|^ฉุก/, 'ER']];
  const guessSetting = code => { const h = SETTING_BY_CODE.find(([re]) => re.test(code || '')); return h ? h[1] : ''; };

  // ------------------------------------------------------------ router
  const TITLES = { home: 'StupidMED', register: 'ลงทะเบียน', block: 'ตั้งค่าบล็อก', case: 'เคส', cases: 'เคสของฉัน', order: 'สั่งกรอก', admin: 'Admin' };
  function go(page, p, replace) {
    const q = new URLSearchParams(Object.assign({ p: page }, p || {}));
    history[replace ? 'replaceState' : 'pushState'](null, '', location.pathname + '?' + q.toString());
    window.scrollTo(0, 0);
    render();
  }
  window.addEventListener('popstate', render);
  $('#backBtn').onclick = () => { if (history.length > 1) history.back(); else go('home'); };

  async function render(quiet) {
    const seq = ++viewSeq;
    const p = params();
    const page = p.p || 'home';
    $('#title').textContent = TITLES[page] || TITLES.home;
    $('#backBtn').hidden = page === 'home';
    document.querySelectorAll('.sticky-bottom').forEach(n => n.remove());
    if (!S.me.user && page !== 'register' && page !== 'admin') return go('register', {}, true);
    if (page === 'admin' && !S.me.isAdmin) { app.innerHTML = '<div class="card empty"><div class="ic"><i class="fas fa-lock"></i></div><b>ไม่มีสิทธิ์เข้าหน้านี้</b></div>'; return; }
    if (!quiet) app.innerHTML = '<div class="loading">กำลังโหลด</div>';
    try {
      await (PAGES[page] || PAGES.home)(p);
    } catch (e) {
      if (seq !== viewSeq) return;   // ผู้ใช้เปลี่ยนหน้าไปแล้ว
      app.innerHTML = `<div class="card"><b>เกิดข้อผิดพลาด</b><div class="muted">${esc(e.message)}</div><div class="btns"><button class="btn" onclick="location.reload()">ลองใหม่</button></div></div>`;
    }
  }
  function bottom(html) {
    const d = document.createElement('div');
    d.className = 'sticky-bottom'; d.innerHTML = `<div class="inner">${html}</div>`;
    document.body.appendChild(d);
    return d;
  }
  function fillAdvisorList() {
    const dl = $('#advisorList');
    if (!dl.childElementCount) dl.innerHTML = O.advisors.map(a => `<option value="${esc(a)}">`).join('');
  }
  function checkAdvisor(input) {
    const v = input.value.trim();
    const bad = v && !ADVISORS.has(v);
    input.classList.toggle('bad', !!bad);
    return !bad;
  }

  const PAGES = {};

  // ------------------------------------------------------------ หน้าแรก
  PAGES.home = async function () {
    await dash();
    const d = S.dash, blocks = activeBlocks(), archived = d.blocks.filter(b => b.archived === '1');
    const card = b => {
      const cs = d.cases.filter(c => c.blockId === b.blockId);
      const open = cs.filter(c => c.status === 'open'), ready = open.filter(c => !c.missing.length);
      const filled = cs.filter(c => c.status === 'filled').length;
      const pct = cs.length ? Math.round(filled / cs.length * 100) : 0;
      return `<div class="card">
        <div class="card-head"><div class="ic"><i class="fas fa-book-medical"></i></div>
          <div style="flex:1;min-width:0"><div class="card-title">${esc(b.course)} <span style="font-weight:600">${esc(b.courseName)}</span></div>
          <div class="muted small"><i class="fas fa-calendar-days"></i> ${range(b.rotStart, b.rotEnd)} · <i class="fas fa-location-dot"></i> ${esc(optText(O.site, b.site))}</div></div>
          <button class="btn sm ghost" data-edit="${b.blockId}" aria-label="แก้บล็อก"><i class="fas fa-pen"></i></button></div>
        <div class="stats"><div><b>${cs.length}</b><span>ทั้งหมด</span></div><div><b>${ready.length}<small style="font-size:13px;color:var(--text-3)">/${open.length}</small></b><span>ครบ/ยังไม่สั่ง</span></div>
        <div><b>${cs.filter(c => c.status === 'ordered').length}</b><span>สั่งแล้ว</span></div><div><b style="color:var(--green-ink)">${filled}</b><span>กรอกแล้ว</span></div></div>
        <div class="progress" title="กรอกแล้ว ${pct}%"><i style="width:${pct}%"></i></div>
        <div class="btns"><button class="btn sm light" data-list="${b.blockId}"><i class="fas fa-list"></i> ดูเคส</button><button class="btn sm" data-add="${b.blockId}"><i class="fas fa-plus"></i> เพิ่มเคส</button>
        ${ready.length ? `<button class="btn sm wine" data-order="${b.blockId}"><i class="fas fa-paper-plane"></i> สั่งกรอก</button>` : ''}</div></div>`;
    };
    const orders = d.orders.filter(o => o.status !== 'cancelled').slice(0, 5);
    app.innerHTML = `
      ${S.me.isAdmin ? `<div class="card tap admin-link" data-go="admin"><div class="card-head"><div class="ic"><i class="fas fa-user-shield"></i></div><div style="flex:1"><div class="card-title" style="color:var(--purple)">หน้า Admin</div><div class="muted small">ตรวจสลิป · รับงาน · ดาวน์โหลด CSV</div></div><i class="fas fa-chevron-right chev"></i></div></div>` : ''}
      <h2><i class="fas fa-layer-group"></i> บล็อก / rotation</h2>
      ${blocks.length ? blocks.map(card).join('') : `<div class="card empty"><div class="ic"><i class="fas fa-layer-group"></i></div><b>ยังไม่มีบล็อก</b><span class="small">ตั้งค่าบล็อกครั้งเดียวต่อ rotation แล้วเพิ่มเคสได้เรื่อย ๆ</span><div class="btns"><button class="btn" data-go="block"><i class="fas fa-sliders"></i> ตั้งค่าบล็อกแรก</button></div></div>`}
      ${blocks.length ? `<button class="btn ghost block" data-go="block"><i class="fas fa-plus"></i> เพิ่มบล็อกใหม่</button>` : ''}
      ${orders.length ? `<h2><i class="fas fa-paper-plane"></i> งานสั่งกรอก</h2><div class="card">${orders.map(o => {
        const b = blockById(o.blockId) || {};
        return `<div class="list-item"><div class="between"><div><b class="mono" style="color:var(--navy);font-size:14px">${esc(o.orderId)}</b><div class="muted">${esc(b.course || '')} · ${o.caseCount} เคส${Number(o.amount) ? ' · ' + o.amount + ' บาท' : ''}</div>
          ${o.note ? `<div class="miss">${esc(o.note)}</div>` : ''}</div><span class="badge ${STATUS_BADGE[o.status] || ''}">${esc(o.statusText)}</span></div>
          ${o.status === 'pending_slip' ? `<div class="btns"><button class="btn sm wine" data-pay="${o.orderId}"><i class="fas fa-qrcode"></i> ชำระเงิน / ดู QR</button></div>` : ''}</div>`;
      }).join('')}</div>` : ''}
      ${archived.length ? `<details><summary>บล็อกที่เก็บแล้ว (${archived.length})</summary>${archived.map(card).join('')}</details>` : ''}
      <p class="foot"><i class="fas fa-user"></i> ${esc(S.me.user.fullName)} · ปี ${esc(S.me.user.year)} · <a href="#" data-go="register">แก้ข้อมูล</a></p>`;
    app.onclick = e => {
      const t = e.target.closest('[data-go],[data-edit],[data-list],[data-add],[data-order],[data-pay]');
      if (!t) return;
      e.preventDefault();
      if (t.dataset.go) go(t.dataset.go);
      else if (t.dataset.edit) go('block', { id: t.dataset.edit });
      else if (t.dataset.list) go('cases', { block: t.dataset.list });
      else if (t.dataset.add) go('case', { block: t.dataset.add });
      else if (t.dataset.order) go('order', { block: t.dataset.order });
      else if (t.dataset.pay) go('order', { o: t.dataset.pay });
    };
    if (blocks.length) bottom(`<button class="btn" id="bAdd"><i class="fas fa-plus"></i> เพิ่มเคส</button><button class="btn wine" id="bOrder"><i class="fas fa-paper-plane"></i> สั่งกรอก</button>`);
    if ($('#bAdd')) { $('#bAdd').onclick = () => go('case'); $('#bOrder').onclick = () => go('order'); }
  };

  // ------------------------------------------------------------ ลงทะเบียน
  PAGES.register = async function () {
    const u = S.me.user || {};
    app.onclick = null;
    app.innerHTML = `<div class="card">
      <div class="muted">ข้อมูลนี้ใช้ให้ทีมงานรู้ว่าเคสเป็นของใคร และเลือกรายวิชาให้ตรงชั้นปี</div>
      <label>ชื่อ-นามสกุล <span class="req">*</span></label><input id="fn" value="${esc(u.fullName || S.me.lineName || '')}">
      <label>รหัสนิสิต</label><input id="sid" inputmode="numeric" value="${esc(u.studentId || '')}">
      <label>ชั้นปี <span class="req">*</span></label>
      <div class="seg" id="yr">${['4', '5', '6'].map(y => `<button type="button" data-y="${y}" class="${u.year === y ? 'on' : ''}">ปี ${y}</button>`).join('')}</div>
    </div>`;
    let year = u.year || '';
    $('#yr').onclick = e => { const b = e.target.closest('button'); if (!b) return; year = b.dataset.y; [...$('#yr').children].forEach(x => x.classList.toggle('on', x === b)); };
    bottom(`<button class="btn" id="save">บันทึก</button>`);
    $('#save').onclick = async e => {
      busy(e.target, true);
      try {
        S.me.user = await api('register', { fullName: $('#fn').value, studentId: $('#sid').value, year });
        saveCache(); showWho();
        toast('บันทึกแล้ว'); go('home', {}, true);
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    };
  };

  // ------------------------------------------------------------ ตั้งค่าบล็อก
  PAGES.block = async function (p) {
    await dash();
    fillAdvisorList();
    const b = p.id ? blockById(p.id) : null;
    if (p.id && !b) throw new Error('ไม่พบบล็อก');
    const v = Object.assign({ course: '', courseName: '', rotStart: '', rotEnd: '', site: 'ONG', setting: '', category: '', complexity: 'Average', advisor: '', detail: '-', logBook: '0', epa: '0' }, b || {});
    const yr = S.me.user.year, courses = S.me.courses;
    const mine = courses.filter(c => c.year === yr), others = courses.filter(c => c.year !== yr);
    const known = courses.some(c => c.code === v.course);
    const copt = c => `<option value="${esc(c.code)}" data-name="${esc(c.name)}"${c.code === v.course ? ' selected' : ''}>${esc(c.code)} ${esc(c.name)}</option>`;
    app.onclick = null;
    app.innerHTML = `<div class="card">
      <label>รายวิชา <span class="req">*</span></label>
      <select id="course"><option value="">— เลือกรายวิชา —</option>
        ${mine.length ? `<optgroup label="ปี ${esc(yr)}">${mine.map(copt).join('')}</optgroup>` : ''}
        ${others.length ? `<optgroup label="ชั้นปีอื่น">${others.map(copt).join('')}</optgroup>` : ''}
        <option value="__other"${v.course && !known ? ' selected' : ''}>อื่น ๆ (พิมพ์รหัสวิชาเอง)</option></select>
      <div id="otherBox" ${v.course && !known ? '' : 'hidden'}><div class="row"><div><label>รหัสวิชา</label><input id="ocode" value="${esc(known ? '' : v.course)}" placeholder="เช่น อย601"></div>
        <div><label>ชื่อวิชา</label><input id="oname" value="${esc(known ? '' : v.courseName)}"></div></div>
        <div class="hint">พิมพ์รหัสให้ตรงกับใน SMART (เช่น อย601)</div></div>
      <div class="row"><div><label>วันเริ่ม rotation <span class="req">*</span></label><input type="date" id="rotStart" value="${esc(v.rotStart)}"></div>
        <div><label>วันจบ rotation <span class="req">*</span></label><input type="date" id="rotEnd" value="${esc(v.rotEnd)}"></div></div>
      <label>สถานปฏิบัติงาน <span class="req">*</span></label><select id="site">${options(O.site, v.site, '— เลือก —')}</select>
    </div>
    <h2><i class="fas fa-sliders"></i> ค่าเริ่มต้นของทุกเคสในบล็อกนี้</h2>
    <div class="card">
      <div class="muted small">เคสไหนไม่ได้ระบุ จะใช้ค่าเหล่านี้</div>
      <label>Clinical setting</label><select id="setting">${options(O.setting, v.setting, '— เลือก —')}</select>
      <div class="row"><div><label>Category</label><select id="category">${options(O.category, v.category, '— เลือก —')}</select></div>
        <div><label>Complexity</label><select id="complexity">${options(O.complexity, v.complexity, '— เลือก —')}</select></div></div>
      <label>อาจารย์ที่ปรึกษา (default)</label><input id="advisor" list="advisorList" value="${esc(v.advisor)}" placeholder="พิมพ์ชื่อแล้วเลือกจากรายการ" autocomplete="off">
      <div class="hint">ต้องเลือกจากรายชื่อใน SMART เพื่อให้กรอกได้ตรงคน</div>
      <label>รายละเอียด (default)</label><input id="detail" value="${esc(v.detail)}">
      <label class="check"><input type="checkbox" id="logBook"${v.logBook === '1' ? ' checked' : ''}> เก็บ log book</label>
      <label class="check"><input type="checkbox" id="epa"${v.epa === '1' ? ' checked' : ''}> เก็บ EPA</label>
    </div>
    ${b ? `<button class="btn ghost block" id="arch"><i class="fas fa-box-archive"></i> ${b.archived === '1' ? 'นำบล็อกกลับมาใช้' : 'เก็บบล็อกนี้ (จบ rotation แล้ว)'}</button>` : ''}`;
    let settingAuto = !v.setting;
    $('#course').onchange = () => {
      const val = $('#course').value;
      $('#otherBox').hidden = val !== '__other';
      if (settingAuto && val && val !== '__other') { const g = guessSetting(val); if (g) { $('#setting').value = g; $('#setting').classList.add('auto'); } }
    };
    $('#setting').onchange = () => { settingAuto = false; $('#setting').classList.remove('auto'); };
    $('#advisor').oninput = () => $('#advisor').classList.remove('bad');
    $('#advisor').onblur = () => checkAdvisor($('#advisor'));
    if ($('#arch')) $('#arch').onclick = async () => {
      try { const nb = await api('archiveBlock', { blockId: b.blockId, archived: b.archived !== '1' }); patchDash(d => upsert(d.blocks, 'blockId', nb)); toast('เรียบร้อย'); go('home', {}, true); }
      catch (err) { toast(err.message, true); }
    };
    bottom(`<button class="btn" id="save">บันทึกบล็อก</button>`);
    $('#save').onclick = async e => {
      const sel = $('#course');
      let course = sel.value, courseName = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.name || '' : '';
      if (course === '__other') { course = $('#ocode').value.trim(); courseName = $('#oname').value.trim(); }
      if (!course) return toast('เลือกรายวิชา', true);
      if (!checkAdvisor($('#advisor'))) return toast('ชื่ออาจารย์ต้องเลือกจากรายการ', true);
      const blk = { blockId: b ? b.blockId : '', course, courseName, rotStart: $('#rotStart').value, rotEnd: $('#rotEnd').value, site: $('#site').value,
        setting: $('#setting').value, category: $('#category').value, complexity: $('#complexity').value, advisor: $('#advisor').value.trim(),
        detail: $('#detail').value, logBook: $('#logBook').checked, epa: $('#epa').checked };
      busy(e.target, true);
      try {
        const saved = await api('saveBlock', { block: blk });
        patchDash(d => upsert(d.blocks, 'blockId', saved)); toast('บันทึกบล็อกแล้ว');
        if (b) go('home', {}, true); else go('case', { block: saved.blockId }, true);
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    };
  };

  // ------------------------------------------------------------ เพิ่ม/แก้เคส
  PAGES.case = async function (p) {
    await dash();
    fillAdvisorList();
    await lib('icd.js');
    const blocks = activeBlocks();
    const editing = p.id ? S.dash.cases.find(c => c.caseId === p.id) : null;
    if (p.id && !editing) throw new Error('ไม่พบเคส');
    // เปิดจากปุ่ม "แก้ไข" บนการ์ดอ่านเคสจากรูป EMR
    let draft = null;
    if (p.draft && !editing) draft = await api('getEmrDraft', { draftId: p.draft });
    if (!blocks.length && !editing) {
      app.onclick = null;
      app.innerHTML = `<div class="card empty"><div class="ic"><i class="fas fa-layer-group"></i></div><b>ต้องตั้งค่าบล็อกก่อนเพิ่มเคส</b><div class="btns"><button class="btn" id="gb"><i class="fas fa-sliders"></i> ตั้งค่าบล็อก</button></div></div>`;
      $('#gb').onclick = () => go('block', {}, true);
      return;
    }
    $('#title').textContent = editing ? 'แก้เคส' : (draft ? 'ตรวจเคสจากรูป' : 'เพิ่มเคส');
    const locked = editing && editing.status !== 'open';
    let blockId = editing ? editing.blockId : draft && blockById(draft.blockId) ? draft.blockId : (p.block && blockById(p.block) ? p.block : (blockById(store.get('lastBlock')) && blockById(store.get('lastBlock')).archived !== '1' ? store.get('lastBlock') : blocks[0].blockId));
    const v = Object.assign({ ptType: store.get('lastPt', 'ผู้ป่วยใน'), hn: '', careStart: '', careEnd: '', diagnosis: '', icd10: '', diseaseGroup: '', detail: '', advisor: '', setting: '', category: '', complexity: '' }, editing || draft || {});
    if (draft && !draft.ptType) v.ptType = store.get('lastPt', 'ผู้ป่วยใน');
    let icdAuto = false, dgAuto = !v.diseaseGroup, ptType = v.ptType;
    const blockList = editing && !blocks.some(b => b.blockId === blockId) ? blocks.concat([blockById(blockId)]) : blocks;

    app.onclick = null;
    app.innerHTML = `
      ${draft ? `<div class="box warnbox"><i class="fas fa-wand-magic-sparkles"></i><div>ข้อมูลนี้อ่านจากรูปโดย AI ตรวจ <b>HN</b> และ<b>วันที่</b>กับเวชระเบียนก่อนบันทึก${draft.warnings && draft.warnings.length ? '<br><span class="small">' + draft.warnings.map(esc).join('<br>') + '</span>' : ''}</div></div>` : ''}
      ${locked ? `<div class="box warnbox"><i class="fas fa-lock"></i><div>เคสนี้อยู่ในงาน ${esc(editing.orderId)} แล้ว แก้ไม่ได้ ถ้าต้องแก้ ให้ยกเลิกงานก่อน</div></div>` : ''}
      <div class="card">
        <label>บล็อก</label><select id="block">${blockList.map(b => `<option value="${b.blockId}"${b.blockId === blockId ? ' selected' : ''}>${esc(b.course)} ${esc(b.courseName)} (${range(b.rotStart, b.rotEnd)})</option>`).join('')}</select>
        <div class="hint" id="blockInfo"></div>
        <label>ประเภทผู้ป่วย <span class="req">*</span></label>
        <div class="seg" id="pt">${O.ptType.map(o => `<button type="button" data-v="${esc(o.value)}" class="${o.value === ptType ? 'on' : ''}">${esc(o.text)}</button>`).join('')}</div>
        <label>HN <span class="req">*</span></label><input id="hn" value="${esc(v.hn)}" autocomplete="off" placeholder="เลข HN">
        <div class="row"><div><label>วันเริ่มดูแล <span class="req">*</span></label><input type="date" id="careStart" value="${esc(v.careStart)}"></div>
          <div><label>วันสิ้นสุดดูแล <span class="req">*</span></label><input type="date" id="careEnd" value="${esc(v.careEnd)}"></div></div>
      </div>
      <div class="card">
        <label>Diagnosis <span class="req">*</span></label><textarea id="dx" placeholder="เช่น Acute appendicitis s/p appendectomy">${esc(v.diagnosis)}</textarea>
        <div class="chips" id="sug"></div>
        <div class="row"><div><label>ICD-10 <span class="req">*</span></label><input id="icd" value="${esc(v.icd10)}" placeholder="K35.8" autocapitalize="characters" autocomplete="off"></div>
          <div style="flex:1.6"><label>กลุ่มโรค <span class="req">*</span></label><select id="dg">${options(O.diseaseGroup.map(g => ({ value: g.value, text: g.value + ' ' + g.text })), v.diseaseGroup, '— เลือก —')}</select></div></div>
        <div class="hint">ICD-10 ที่ระบบแนะนำเป็นแค่คำแนะนำ ตรวจก่อนบันทึกเสมอ</div>
        <label>รายละเอียด</label><textarea id="detail" style="min-height:50px">${esc(v.detail)}</textarea>
        <label>อาจารย์</label><input id="advisor" list="advisorList" value="${esc(v.advisor)}" autocomplete="off">
        <details ${v.setting || v.category || v.complexity ? 'open' : ''}><summary>Setting / Category / Complexity (ถ้าต่างจากบล็อก)</summary>
          <label>Clinical setting</label><select id="setting"></select>
          <div class="row"><div><label>Category</label><select id="category"></select></div><div><label>Complexity</label><select id="complexity"></select></div></div>
        </details>
      </div>
      <div class="box warnbox" id="missBox" hidden></div>
      ${editing && !locked ? `<button class="btn danger block" id="del"><i class="fas fa-trash"></i> ลบเคสนี้</button>` : ''}`;

    const blk = () => blockById($('#block').value) || {};
    function syncBlock() {
      const b = blk();
      $('#blockInfo').textContent = `ค่า default: ${b.setting || '—'} · ${optText(O.category, b.category) || '—'} · ${b.complexity || '—'} · อ.${b.advisor ? b.advisor.replace(/^(อาจารย์|อ\.)\s*/, '') : ' —'}`;
      $('#detail').placeholder = `เว้นว่าง = ใช้ค่าบล็อก (${b.detail || '-'})`;
      $('#advisor').placeholder = b.advisor ? `เว้นว่าง = ${b.advisor}` : 'พิมพ์ชื่อแล้วเลือกจากรายการ';
      $('#setting').innerHTML = options(O.setting, v.setting, `(ใช้ค่าบล็อก: ${b.setting || '—'})`);
      $('#category').innerHTML = options(O.category, v.category, `(ใช้ค่าบล็อก: ${optText(O.category, b.category) || '—'})`);
      $('#complexity').innerHTML = options(O.complexity, v.complexity, `(ใช้ค่าบล็อก: ${b.complexity || '—'})`);
      refreshMissing();
    }
    function current() {
      return { caseId: editing ? editing.caseId : '', blockId: $('#block').value, ptType, hn: $('#hn').value.trim(), careStart: $('#careStart').value, careEnd: $('#careEnd').value,
        diagnosis: $('#dx').value.trim(), icd10: $('#icd').value.trim().toUpperCase(), diseaseGroup: $('#dg').value, detail: $('#detail').value.trim(),
        advisor: $('#advisor').value.trim(), setting: $('#setting').value, category: $('#category').value, complexity: $('#complexity').value };
    }
    function refreshMissing() {
      const m = missing(current(), blk());
      $('#missBox').hidden = !m.length;
      $('#missBox').innerHTML = '<i class="fas fa-triangle-exclamation"></i><div>ยังขาด: ' + esc(m.join(', ')) + '<br><span class="small">บันทึกไว้ก่อนได้ แต่จะสั่งกรอกได้เมื่อครบ</span></div>';
    }
    function setIcd(code, auto) {
      $('#icd').value = code; icdAuto = auto; $('#icd').classList.toggle('auto', auto);
      if (dgAuto) { const g = ICD.icdToGroup(code); if (g) { $('#dg').value = g; $('#dg').classList.add('auto'); } }
      refreshMissing();
    }
    let sugT;
    function suggest() {
      const list = ICD.suggestICD($('#dx').value);
      $('#sug').innerHTML = list.map(s => `<button type="button" class="chip${s.code === $('#icd').value ? ' on' : ''}" data-code="${esc(s.code)}"><b>${esc(s.code)}</b> ${esc(s.label)}</button>`).join('');
      if (list.length && (!$('#icd').value || icdAuto)) setIcd(list[0].code, true);
      if (!list.length && icdAuto) setIcd('', false);
    }
    $('#block').onchange = () => { v.setting = v.category = v.complexity = ''; syncBlock(); };
    $('#pt').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      ptType = b.dataset.v; [...$('#pt').children].forEach(x => x.classList.toggle('on', x === b));
      if (ptType === 'ผู้ป่วยนอก' && $('#careStart').value && !$('#careEnd').value) $('#careEnd').value = $('#careStart').value;
      refreshMissing();
    };
    $('#careStart').onchange = () => { if (ptType === 'ผู้ป่วยนอก' || !$('#careEnd').value) { if (ptType === 'ผู้ป่วยนอก') $('#careEnd').value = $('#careStart').value; } refreshMissing(); };
    $('#dx').oninput = () => { clearTimeout(sugT); sugT = setTimeout(suggest, 250); refreshMissing(); };
    $('#sug').onclick = e => { const c = e.target.closest('[data-code]'); if (c) { setIcd(c.dataset.code, false); suggest(); } };
    $('#icd').oninput = () => { icdAuto = false; $('#icd').classList.remove('auto'); if (dgAuto) { const g = ICD.icdToGroup($('#icd').value); if (g) { $('#dg').value = g; $('#dg').classList.add('auto'); } } refreshMissing(); };
    $('#dg').onchange = () => { dgAuto = false; $('#dg').classList.remove('auto'); refreshMissing(); };
    $('#advisor').oninput = () => { $('#advisor').classList.remove('bad'); refreshMissing(); };
    $('#advisor').onblur = () => checkAdvisor($('#advisor'));
    ['hn', 'careEnd', 'detail', 'setting', 'category', 'complexity'].forEach(id => { $('#' + id).addEventListener('input', refreshMissing); $('#' + id).addEventListener('change', refreshMissing); });
    syncBlock();
    if (v.diagnosis) { const list = ICD.suggestICD(v.diagnosis); $('#sug').innerHTML = list.map(s => `<button type="button" class="chip${s.code === v.icd10 ? ' on' : ''}" data-code="${esc(s.code)}"><b>${esc(s.code)}</b> ${esc(s.label)}</button>`).join(''); }
    if (locked) app.querySelectorAll('input,select,textarea,.seg button').forEach(n => { if (n.id !== 'block') n.disabled = true; });
    if (locked) $('#block').disabled = true;

    if ($('#del')) $('#del').onclick = async () => {
      if (!confirm('ลบเคส HN ' + editing.hn + ' ?')) return;
      try { await api('deleteCase', { caseId: editing.caseId }); patchDash(d => { d.cases = d.cases.filter(x => x.caseId !== editing.caseId); }); toast('ลบแล้ว'); history.back(); } catch (err) { toast(err.message, true); }
    };
    if (locked) return;

    async function save(btn, again, allowDuplicate) {
      const c = current();
      if (!c.hn) return toast('กรอก HN', true);
      if (!checkAdvisor($('#advisor'))) return toast('ชื่ออาจารย์ต้องเลือกจากรายการ', true);
      busy(btn, true);
      try {
        const saved = await api('saveCase', { case: c, allowDuplicate: !!allowDuplicate, draftId: draft ? draft.draftId : '' });
        if (draft) { draft = null; history.replaceState(null, '', location.pathname + '?p=case&block=' + encodeURIComponent(c.blockId)); }
        store.set('lastBlock', c.blockId); store.set('lastPt', c.ptType);
        patchDash(d => upsert(d.cases, 'caseId', saved));
        toast(saved.missing.length ? `บันทึกแล้ว (ยังขาด ${saved.missing.length} ช่อง)` : 'บันทึกแล้ว ครบทุกช่อง');
        busy(btn, false);
        if (again) {
          ['hn', 'dx', 'icd', 'detail', 'advisor'].forEach(id => { $('#' + id).value = ''; $('#' + id).classList.remove('auto', 'bad'); });
          $('#dg').value = ''; $('#dg').classList.remove('auto'); $('#sug').innerHTML = ''; icdAuto = false; dgAuto = true;
          window.scrollTo(0, 0); $('#hn').focus(); refreshMissing();
        } else history.back();
      } catch (err) {
        busy(btn, false);
        if (err.message.startsWith('DUP:')) { if (confirm(err.message.slice(4) + '\nบันทึกซ้ำอีกเคส?')) save(btn, again, true); }
        else toast(err.message, true);
      }
    }
    bottom(editing ? `<button class="btn" id="s1">บันทึก</button>` : `<button class="btn ghost" id="s2">บันทึก + เพิ่มต่อ</button><button class="btn" id="s1">บันทึก</button>`);
    $('#s1').onclick = e => save(e.target, false);
    if ($('#s2')) $('#s2').onclick = e => save(e.target, true);
  };

  // ------------------------------------------------------------ รายการเคส
  PAGES.cases = async function (p) {
    await dash();
    const d = S.dash;
    const blocks = d.blocks.slice().reverse();
    let bid = p.block || (activeBlocks()[0] || {}).blockId || '';
    function draw() {
      const b = blockById(bid);
      const cs = d.cases.filter(c => c.blockId === bid).sort((a, x) => (x.careStart || '').localeCompare(a.careStart || ''));
      const badge = c => c.status === 'filled' ? '<span class="badge ok">กรอกแล้ว</span>' : c.status === 'ordered' ? '<span class="badge">สั่งแล้ว</span>'
        : c.missing.length ? `<span class="badge warn">ขาด ${c.missing.length}</span>` : '<span class="badge ok">ครบ</span>';
      app.innerHTML = `
        <select id="bsel">${blocks.map(x => `<option value="${x.blockId}"${x.blockId === bid ? ' selected' : ''}>${esc(x.course)} ${esc(x.courseName)}${x.archived === '1' ? ' (เก็บแล้ว)' : ''}</option>`).join('')}</select>
        <div class="muted small" style="margin:8px 2px 12px">${b ? '<i class="fas fa-calendar-days"></i> ' + range(b.rotStart, b.rotEnd) + ' · ' + cs.length + ' เคส' : ''}</div>
        ${cs.length ? `<div class="card">${cs.map(c => `<div class="list-item tap ${c.status === 'filled' ? 'done' : c.status === 'open' && c.missing.length ? 'hl' : ''}" data-id="${c.caseId}">
          <div class="between"><div style="min-width:0"><span class="hn">HN ${esc(c.hn)}</span> <span class="tag">${esc(c.ptType === 'ผู้ป่วยนอก' ? 'OPD' : 'IPD')}</span> <span class="muted small">${range(c.careStart, c.careEnd)}</span>
          <div style="margin-top:2px">${esc(c.diagnosis || '—')} ${c.icd10 ? `<code class="mono pill">${esc(c.icd10)}</code>` : ''}</div>
          ${c.status === 'open' && c.missing.length ? `<div class="miss"><i class="fas fa-triangle-exclamation"></i>ขาด: ${esc(c.missing.join(', '))}</div>` : ''}</div>${badge(c)}</div></div>`).join('')}</div>`
          : `<div class="card empty"><div class="ic"><i class="fas fa-notes-medical"></i></div><b>ยังไม่มีเคสในบล็อกนี้</b></div>`}`;
      $('#bsel').onchange = () => { bid = $('#bsel').value; history.replaceState(null, '', '?p=cases&block=' + bid); draw(); };
    }
    if (!blocks.length) { app.innerHTML = '<div class="card empty"><div class="ic"><i class="fas fa-layer-group"></i></div><b>ยังไม่มีบล็อก</b></div>'; return; }
    draw();
    app.onclick = e => { const t = e.target.closest('[data-id]'); if (t) go('case', { id: t.dataset.id }); };
    bottom(`<button class="btn" id="add"><i class="fas fa-plus"></i> เพิ่มเคส</button><button class="btn wine" id="ord"><i class="fas fa-paper-plane"></i> สั่งกรอก</button>`);
    $('#add').onclick = () => go('case', { block: bid });
    $('#ord').onclick = () => go('order', { block: bid });
  };

  // ------------------------------------------------------------ สั่งกรอก + ชำระเงิน
  PAGES.order = async function (p) {
    await dash();
    if (p.o && !S.dash.orders.some(x => x.orderId === p.o)) await loadDash();
    if (p.o) return payView(p.o);
    const d = S.dash;
    const blocks = activeBlocks().filter(b => d.cases.some(c => c.blockId === b.blockId && c.status === 'open'));
    if (!blocks.length) { app.onclick = null; app.innerHTML = '<div class="card empty"><div class="ic"><i class="fas fa-inbox"></i></div><b>ยังไม่มีเคสที่รอสั่งกรอก</b><span class="small">เพิ่มเคสก่อน แล้วค่อยกลับมาสั่ง</span></div>'; return; }
    let bid = blocks.some(b => b.blockId === p.block) ? p.block : blocks[0].blockId;
    const pay = S.me.pay;
    app.onclick = null;
    app.innerHTML = `<div class="card"><label>เลือกบล็อก</label><select id="bsel">${blocks.map(b => `<option value="${b.blockId}"${b.blockId === bid ? ' selected' : ''}>${esc(b.course)} ${esc(b.courseName)}</option>`).join('')}</select><div id="sum"></div></div>
      <h2><i class="fas fa-key"></i> บัญชี SMART</h2>
      <div class="card">
        <div class="muted small">ทีมงานใช้บัญชีนี้ login เข้า SMART เพื่อกรอกเคสตามรายการด้านบนเท่านั้น และลบออกจากระบบเมื่องานเสร็จ</div>
        <label>Username <span class="req">*</span></label><input id="su" autocomplete="off" autocapitalize="off" spellcheck="false">
        <label>Password <span class="req">*</span></label><div class="row"><input id="sp" type="password" autocomplete="off"><button type="button" class="btn sm ghost" id="eye" style="flex:0 0 auto"><i class="fas fa-eye"></i></button></div>
        <label class="check"><input type="checkbox" id="agree"> ยินยอมให้ทีมงานใช้บัญชีนี้กรอกเคสให้</label>
      </div>`;
    function sum() {
      const b = blockById(bid);
      const open = d.cases.filter(c => c.blockId === bid && c.status === 'open');
      const ready = open.filter(c => !c.missing.length), notReady = open.filter(c => c.missing.length);
      const pend = d.orders.find(o => o.blockId === bid && ['pending_slip', 'slip_review'].includes(o.status));
      const price = Math.max(pay.minPrice, ready.length * pay.pricePerCase);
      $('#sum').innerHTML = `<div class="muted small" style="margin-top:6px">${range(b.rotStart, b.rotEnd)} · ${esc(optText(O.site, b.site))}</div>
        ${pend ? `<div class="box warnbox"><i class="fas fa-clock"></i><div>บล็อกนี้มีงาน ${esc(pend.orderId)} ที่ยัง${esc(pend.statusText)}อยู่ <a href="#" data-pay="${pend.orderId}">ดูงาน</a></div></div>` : ''}
        <div class="list-item"><b>${ready.length} เคสที่ครบ</b> จะถูกส่งกรอก${price ? ` · <b>${price} บาท</b>` : ''}
          <div class="muted small">${ready.map(c => 'HN ' + esc(c.hn)).join(', ') || '—'}</div></div>
        ${notReady.length ? `<div class="list-item"><span class="badge warn">ยังไม่ครบ ${notReady.length} เคส</span> <span class="muted small">— ไม่ถูกส่งรอบนี้</span>
          ${notReady.map(c => `<div class="miss">HN ${esc(c.hn)}: ขาด ${esc(c.missing.join(', '))}</div>`).join('')}</div>` : ''}`;
      $('#go').disabled = !ready.length || !!pend;
    }
    bottom(`<button class="btn wine" id="go">ยืนยันสั่งกรอก</button>`);
    sum();
    $('#bsel').onchange = () => { bid = $('#bsel').value; sum(); };
    $('#sum').onclick = e => { const t = e.target.closest('[data-pay]'); if (t) { e.preventDefault(); go('order', { o: t.dataset.pay }); } };
    $('#eye').onclick = () => { const i = $('#sp'); i.type = i.type === 'password' ? 'text' : 'password'; $('#eye').innerHTML = i.type === 'password' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>'; };
    $('#go').onclick = async e => {
      if (!$('#su').value.trim() || !$('#sp').value) return toast('กรอก username / password ของ SMART', true);
      if (!$('#agree').checked) return toast('ติ๊กยินยอมก่อน', true);
      busy(e.target, true);
      try {
        const r = await api('createOrder', { blockId: bid, smartUser: $('#su').value.trim(), smartPass: $('#sp').value });
        $('#sp').value = '';
        const ids = String(r.order.caseIds || '').split(',');
        patchDash(d => { d.orders.unshift(Object.assign({ statusText: ST_TH[r.order.status] || r.order.status }, r.order)); d.cases.forEach(c => { if (ids.indexOf(c.caseId) >= 0) { c.status = 'ordered'; c.orderId = r.order.orderId; } }); });
        toast('สร้างงานแล้ว'); go('order', { o: r.order.orderId }, true);
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    };
  };

  async function payView(orderId) {
    const o = S.dash.orders.find(x => x.orderId === orderId);
    if (!o) throw new Error('ไม่พบงาน');
    const b = blockById(o.blockId) || {};
    const pay = S.me.pay, amt = Number(o.amount);
    let qr = '';
    if (pay.promptpayId && o.status === 'pending_slip') {
      await Promise.all([lib('vendor/qrcode.js'), lib('promptpay.js')]);
      const q = qrcode(0, 'M'); q.addData(PromptPay.payload(pay.promptpayId, amt)); q.make();
      qr = `<div class="pp"><div class="pp-head">PromptPay</div><div class="qr">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
        <div class="pp-foot"><b>${esc(pay.promptpayName)}</b><div class="muted small mono">${esc(pay.promptpayId)}</div></div></div>`;
    }
    app.onclick = null;
    app.innerHTML = `<div class="card"><div class="between"><div><b class="mono" style="color:var(--navy);font-size:14px">${esc(o.orderId)}</b><div class="muted">${esc(b.course || '')} ${esc(b.courseName || '')} · ${o.caseCount} เคส</div></div>
      <span class="badge ${STATUS_BADGE[o.status] || ''}">${esc(o.statusText)}</span></div>
      ${o.note ? `<div class="box warnbox"><i class="fas fa-circle-exclamation"></i><div>${esc(o.note)}</div></div>` : ''}</div>
      ${o.status === 'pending_slip' ? `
        <div class="card">
          <div style="text-align:center">${amt ? `<div class="muted">ยอดชำระ</div><div class="big">${amt.toLocaleString()} บาท</div>` : '<div class="muted">โอนตามยอดที่ตกลงกับทีมงาน</div>'}</div>
          ${qr || '<div class="box warnbox"><i class="fas fa-circle-exclamation"></i><div>ยังไม่ได้ตั้งค่าบัญชีรับเงิน ติดต่อทีมงาน</div></div>'}
          ${pay.note ? `<div class="box infobox"><i class="fas fa-circle-info"></i><div>${esc(pay.note)}</div></div>` : ''}
          <div class="box infobox"><i class="fas fa-receipt"></i><div><b>ขั้นต่อไป</b><ol class="steps"><li>แคปหน้าจอ QR นี้</li><li>โอนผ่านแอปธนาคาร</li><li><b>ส่งรูปสลิปในแชท LINE นี้</b> ระบบผูกสลิปกับงานให้เอง</li></ol></div></div>
        </div>` : ''}
      ${o.status === 'slip_review' ? '<div class="box infobox"><i class="fas fa-hourglass-half"></i><div>ได้รับสลิปแล้ว รอทีมงานตรวจ จะแจ้งในแชทครับ</div></div>' : ''}
      ${o.status === 'paid' || o.status === 'in_progress' ? '<div class="box okbox"><i class="fas fa-circle-check"></i><div>ชำระเงินแล้ว งานอยู่ในคิวกรอก</div></div>' : ''}
      ${o.status === 'pending_slip' ? '<button class="btn danger block" id="cancel"><i class="fas fa-ban"></i> ยกเลิกงานนี้</button>' : ''}`;
    const inLine = window.liff && liff.isInClient && liff.isInClient();
    if (o.status === 'pending_slip' || o.status === 'slip_review') {
      bottom(`<button class="btn" id="chat">${inLine ? 'กลับไปแชทเพื่อส่งสลิป' : 'กลับหน้าแรก'}</button>`);
      $('#chat').onclick = () => { if (inLine) liff.closeWindow(); else go('home'); };
    }
    if ($('#cancel')) $('#cancel').onclick = async () => {
      if (!confirm('ยกเลิกงาน ' + o.orderId + ' ? เคสจะกลับไปอยู่ในรายการ')) return;
      try {
        await api('cancelOrder', { orderId: o.orderId });
        patchDash(d => { const x = d.orders.find(y => y.orderId === o.orderId); if (x) { x.status = 'cancelled'; x.statusText = ST_TH.cancelled; } d.cases.forEach(c => { if (c.orderId === o.orderId) { c.status = 'open'; c.orderId = ''; } }); });
        toast('ยกเลิกแล้ว'); go('home', {}, true);
      } catch (err) { toast(err.message, true); }
    };
  }

  // ------------------------------------------------------------ Admin
  const ADMIN_FILTERS = [['active', 'งานค้าง'], ['slip_review', 'รอตรวจสลิป'], ['paid', 'รอกรอก'], ['in_progress', 'กำลังกรอก'], ['done', 'เสร็จแล้ว'], ['', 'ทั้งหมด']];
  PAGES.admin = async function (p) {
    if (p.o) return adminOrder(p.o);
    const f = p.f == null ? 'active' : p.f;
    const key = 'L:' + f, seq = viewSeq;
    if (AC[key]) {   // แสดงรายการเดิมทันที แล้วดึงใหม่เบื้องหลัง
      drawAdminList(f, AC[key]);
      api('adminOrders', { status: f }).then(l => { const ch = JSON.stringify(l) !== JSON.stringify(AC[key]); AC[key] = l; if (ch && seq === viewSeq) drawAdminList(f, l); }).catch(() => {});
      return;
    }
    AC[key] = await api('adminOrders', { status: f });
    if (seq === viewSeq) drawAdminList(f, AC[key]);
  };
  const AC = {};   // แคชหน้า admin (ในหน่วยความจำเท่านั้น ไม่เก็บลงเครื่อง)
  function drawAdminList(f, list0) {
    const list = list0.slice();
    const inLine = window.liff && liff.isInClient && liff.isInClient();
    const order = { slip_review: 0, paid: 1, in_progress: 2, pending_slip: 3 };
    if (f === 'active') list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    app.innerHTML = `
      ${inLine ? `<div class="box infobox"><i class="fas fa-desktop"></i><div>ดาวน์โหลด CSV สะดวกกว่าบนคอม <a href="#" id="ext">เปิดในเบราว์เซอร์</a></div></div>` : ''}
      <div class="filters">${ADMIN_FILTERS.map(([k, t]) => `<button class="chip${k === f ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
      ${list.length ? list.map(o => `<div class="card tap" data-o="${esc(o.orderId)}">
        <div class="between"><div><b class="mono" style="color:var(--navy);font-size:14px">${esc(o.orderId)}</b> <span class="badge ${STATUS_BADGE[o.status] || ''}">${esc(o.statusText)}</span>
        <div><b>${esc(o.userName)}</b> <span class="muted">ปี ${esc(o.year)}${o.studentId ? ' · ' + esc(o.studentId) : ''}</span></div>
        <div class="muted small">${esc(o.course)} ${esc(o.courseName)} · ${o.caseCount} เคส · ${Number(o.amount) || 0} บาท</div>
        ${o.assignee ? `<div class="muted small"><i class="fas fa-user-check"></i> ${esc(o.assignee)}</div>` : ''}</div><i class="fas fa-chevron-right chev"></i></div></div>`).join('') : '<div class="card empty"><div class="ic"><i class="fas fa-mug-hot"></i></div><b>ไม่มีงาน</b></div>'}`;
    app.onclick = e => {
      const c = e.target.closest('[data-f]'); if (c) return go('admin', { f: c.dataset.f }, true);
      const t = e.target.closest('[data-o]'); if (t) return go('admin', { o: t.dataset.o });
      if (e.target.id === 'ext') { e.preventDefault(); liff.openWindow({ url: location.href, external: true }); }
    };
  }

  async function adminOrder(orderId) {
    const d = await api('adminOrderDetail', { orderId });
    const o = d.order, u = d.user, b = d.block;
    $('#title').textContent = o.orderId;
    const st = o.status;
    const btn = (id, cls, t) => `<button class="btn ${cls}" id="${id}">${t}</button>`;
    app.onclick = null;
    app.innerHTML = `
      <div class="card"><div class="between"><div><b>${esc(u.fullName || u.displayName || o.userId)}</b><div class="muted">ปี ${esc(u.year)} · ${esc(u.studentId || '—')}</div></div>
        <span class="badge ${STATUS_BADGE[st] || ''}">${esc(o.statusText)}</span></div>
        <div class="list-item"><b>${esc(b.course)}</b> ${esc(b.courseName)}<div class="muted small">rotation ${range(b.rotStart, b.rotEnd)} · ${esc(optText(O.site, b.site))} · ${esc(b.setting)} · log book ${b.logBook === '1' ? 'เก็บ' : 'ไม่เก็บ'} · EPA ${b.epa === '1' ? 'เก็บ' : 'ไม่เก็บ'}</div></div>
        <div class="muted small">${o.caseCount} เคส · ${Number(o.amount) || 0} บาท · สร้าง ${esc(o.createdAt)}${o.slipAt ? ' · สลิป ' + esc(o.slipAt) : ''}${o.approvedBy ? ' · อนุมัติโดย ' + esc(o.approvedBy) : ''}${o.assignee ? ' · ผู้รับงาน ' + esc(o.assignee) : ''}</div>
        ${o.note ? `<div class="box warnbox"><i class="fas fa-circle-exclamation"></i><div>${esc(o.note)}</div></div>` : ''}</div>

      ${o.slipFileId ? `<div class="card slip"><div class="between"><b>สลิป</b>${d.slip ? '' : '<button class="btn sm light" id="loadSlip">ดูสลิป</button>'}</div>
        ${o.slipCheck && o.slipCheck !== 'checking' ? `<div class="box ${o.slipCheck === 'pass' ? 'okbox' : 'warnbox'} small"><i class="fas fa-${o.slipCheck === 'pass' ? 'circle-check' : 'triangle-exclamation'}"></i><div><b>ตรวจอัตโนมัติ: ${esc({ pass: 'ผ่าน', flag: 'ต้องตรวจ', retry: 'รอธนาคาร ตรวจซ้ำอัตโนมัติ', noqr: 'ไม่พบ QR', manual: 'ตรวจอัตโนมัติไม่ได้' }[o.slipCheck] || o.slipCheck)}</b>${o.slipCheckNote ? '<br>' + esc(o.slipCheckNote) : ''}</div></div>` : ''}
        <div id="slipBox">${d.slip ? `<img src="${d.slip}" alt="slip" style="margin-top:8px">` : ''}</div></div>` : ''}

      <div class="card"><b>ดำเนินการ</b><div class="btns">
        ${st === 'slip_review' ? btn('approve', '', '<i class="fas fa-circle-check"></i> สลิปถูกต้อง') + btn('reject', 'danger', '<i class="fas fa-xmark"></i> ไม่ผ่าน') : ''}
        ${st === 'pending_slip' ? btn('approve', 'ghost', 'อนุมัติโดยไม่มีสลิป') : ''}
        ${st === 'paid' ? btn('claim', '', '<i class="fas fa-hand"></i> รับงานนี้') : ''}
        ${st === 'paid' || st === 'in_progress' ? btn('done', 'green', '<i class="fas fa-check-double"></i> กรอกเสร็จแล้ว (ปิดงาน)') : ''}
        ${st === 'in_progress' ? btn('release', 'ghost', '<i class="fas fa-rotate-left"></i> ปล่อยงาน') : ''}
      </div></div>

      ${st === 'paid' || st === 'in_progress' ? `<div class="card"><b>ไฟล์และบัญชี</b>
        <div class="btns">${btn('dl', '', '<i class="fas fa-file-arrow-down"></i> ดาวน์โหลด CSV')}${btn('copy', 'light', '<i class="fas fa-copy"></i> คัดลอก CSV')}</div>
        <div class="btns">${d.hasCred ? btn('cred', 'wine', '<i class="fas fa-key"></i> แสดงบัญชี SMART') : '<span class="muted">ไม่มีข้อมูลบัญชี</span>'}</div><div id="credBox"></div>
        <div class="box infobox small"><i class="fas fa-list-check"></i><div><b>ขั้นตอนกรอก</b><ol class="steps"><li>เปิด Chrome profile สำหรับลูกค้า แล้ว login SMART ด้วยบัญชีด้านบน</li><li>เปิดเมนู "บันทึกผู้ป่วยใน/ผู้ป่วยนอก"</li><li>Autofill StupidMED: นำเข้า CSV, ตรวจ, รันออโต้</li><li>ตรวจในตาราง SMART ว่าครบ แล้ว logout และกด "กรอกเสร็จแล้ว"</li></ol></div></div></div>` : ''}

      <div class="card"><b>เคส (${d.cases.length})</b>
        <table class="cases"><tr><th>#</th><th>HN / วันที่</th><th>Dx / ICD</th><th>อาจารย์</th></tr>
        ${d.cases.map((c, i) => `<tr><td>${i + 1}</td><td><b>${esc(c.hn)}</b><br><span class="muted">${esc(c.ptType === 'ผู้ป่วยนอก' ? 'OPD' : 'IPD')} ${range(c.careStart, c.careEnd)}</span></td>
          <td>${esc(c.diagnosis)}<br><span class="mono muted">${esc(c.icd10)} · กลุ่ม ${esc(c.diseaseGroup)}</span>${c.missing.length ? `<div class="miss">ขาด: ${esc(c.missing.join(', '))}</div>` : ''}</td>
          <td class="small">${esc(c.advisor || b.advisor)}</td></tr>`).join('')}</table></div>
      ${st !== 'done' && st !== 'cancelled' ? `<button class="btn danger block" id="cancel"><i class="fas fa-ban"></i> ยกเลิกงาน (คืนเคสให้ผู้ใช้)</button>` : ''}`;

    const act = (id, fn) => { const n = $('#' + id); if (n) n.onclick = async () => { try { n.disabled = true; await fn(); } catch (err) { toast(err.message, true); n.disabled = false; } }; };
    const reload = () => { Object.keys(AC).forEach(k => delete AC[k]); go('admin', { o: orderId }, true); };
    act('loadSlip', async () => { $('#slipBox').innerHTML = '<div class="muted">กำลังโหลด…</div>'; const src = await api('adminSlip', { orderId }); $('#slipBox').innerHTML = `<img src="${src}" alt="slip" style="margin-top:8px">`; });
    act('approve', async () => { if (st === 'pending_slip' && !confirm('อนุมัติโดยยังไม่มีสลิป?')) throw new Error('ยกเลิก'); await api('adminApprove', { orderId }); toast('อนุมัติแล้ว แจ้งผู้ใช้แล้ว'); reload(); });
    act('reject', async () => { const note = prompt('เหตุผลที่สลิปไม่ผ่าน (ส่งให้ผู้ใช้)', 'ยอดเงินไม่ตรง'); if (note == null) throw new Error('ยกเลิก'); await api('adminReject', { orderId, note }); toast('แจ้งผู้ใช้แล้ว'); reload(); });
    act('claim', async () => { await api('adminClaim', { orderId }); toast('รับงานแล้ว'); reload(); });
    act('release', async () => { await api('adminRelease', { orderId }); reload(); });
    act('done', async () => { const note = prompt('ปิดงาน — หมายเหตุถึงผู้ใช้ (เว้นว่างได้)', ''); if (note == null) throw new Error('ยกเลิก'); await api('adminDone', { orderId, note }); toast('ปิดงานแล้ว ลบบัญชีแล้ว'); reload(); });
    act('cancel', async () => { const note = prompt('เหตุผลที่ยกเลิก (ส่งให้ผู้ใช้)', ''); if (note == null) throw new Error('ยกเลิก'); await api('adminCancel', { orderId, note }); toast('ยกเลิกแล้ว'); reload(); });
    act('dl', async () => {
      const url = URL.createObjectURL(new Blob([d.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = d.csvName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000); $('#dl').disabled = false;
    });
    act('copy', async () => { await navigator.clipboard.writeText(d.csv.replace(/^﻿/, '')); toast('คัดลอกแล้ว'); $('#copy').disabled = false; });
    act('cred', async () => {
      const c = await api('adminCred', { orderId });
      $('#credBox').innerHTML = `<div class="cred"><div class="lbl">Username</div><div class="between" style="align-items:center"><span class="mono">${esc(c.smartUser)}</span><button class="btn sm light" data-cp="u"><i class="fas fa-copy"></i></button></div>
        <div class="lbl" style="margin-top:10px">Password</div><div class="between" style="align-items:center"><span class="mono">${esc(c.smartPass)}</span><button class="btn sm light" data-cp="p"><i class="fas fa-copy"></i></button></div></div>`;
      $('#credBox').onclick = async e => { const t = e.target.closest('[data-cp]'); if (t) { await navigator.clipboard.writeText(t.dataset.cp === 'u' ? c.smartUser : c.smartPass); toast('คัดลอกแล้ว'); } };
    });
    if (st === 'slip_review' && !d.slip && $('#loadSlip')) $('#loadSlip').click();
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    let ready, fail;
    S.ready = new Promise((a, b) => { ready = a; fail = b; });
    S.ready.catch(() => {});
    // เปิดผ่าน liff.line.me รอบแรกจะมี liff.state แล้ว LINE พาไปหน้าจริงอีกรอบ → ไม่ต้องวาดจากแคชรอบนี้
    const firstHop = /[?&]liff\.state=/.test(location.search);
    const lastUid = store.get('smd:lastUid', '');
    const cached = !firstHop && lastUid ? readCache(lastUid) : null;
    let shown = false;
    if (cached && cached.me) {   // วาดจากข้อมูลเดิมในเครื่องทันที ไม่ต้องรอ LINE/เซิร์ฟเวอร์
      S.uid = lastUid; S.me = cached.me; S.dash = cached.dash || null; dashAt = Date.now();   // boot จะดึงใหม่ให้เอง
      showWho(); render(); shown = true;
    }
    try {
      if (C.MOCK_LIFF) {
        const uid = new URLSearchParams(location.search).get('mockUser') || store.get('mockUser', 'Ustu');
        store.set('mockUser', uid);
        window.liff = { init: async () => {}, isLoggedIn: () => true, getIDToken: () => 'mock:' + uid + ':' + uid, getDecodedIDToken: () => ({ sub: uid }), isInClient: () => false, closeWindow: () => {}, openWindow: o => window.open(o.url) };
      }
      await liff.init({ liffId: C.LIFF_ID });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      S.idToken = liff.getIDToken();
      const tokUid = (liff.getDecodedIDToken && liff.getDecodedIDToken() || {}).sub || '';
      ready();
      const sameUser = !shown || !tokUid || tokUid === lastUid;
      if (!sameUser) { S.me = null; S.dash = null; }
      const before = JSON.stringify([S.me, S.dash]);
      const m = mutSeq;
      let r;
      try { r = await api('boot'); }
      catch (err) {   // Code.gs ตัวเก่ายังไม่มี boot → เรียกแบบเดิม 2 รอบ
        if (!/unknown action/.test(err.message)) throw err;
        const me = await api('me');
        r = { me, dash: me.user ? await api('dashboard') : null };
      }
      S.uid = r.me.userId; store.set('smd:lastUid', S.uid);
      S.me = r.me;
      if (m === mutSeq) { if (r.dash) setDash(r.dash); else { S.dash = null; saveCache(); } }
      showWho();
      if (!shown || !sameUser) render();
      else if (JSON.stringify([S.me, S.dash]) !== before) quietRerender(viewSeq);
    } catch (e) {
      fail(e);
      if (shown) return toast(e.message, true);
      app.innerHTML = `<div class="card"><b>เปิดไม่สำเร็จ</b><div class="muted">${esc(e.message)}</div><div class="btns"><button class="btn" onclick="location.reload()">ลองใหม่</button></div></div>`;
    }
  }
  boot();
})();
