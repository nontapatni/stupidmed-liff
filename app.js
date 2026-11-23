/* AutofillSMARTMED — LIFF app (หน้าเดียว, ?p=หน้า) */
(function () {
  'use strict';
  const C = window.APP_CONFIG, O = window.OPT;
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const S = { me: null, dash: null, idToken: '' };

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
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.t = btn.textContent; btn.textContent = 'กำลังบันทึก…'; } else if (btn.dataset.t) btn.textContent = btn.dataset.t; }

  async function api(action, data) {
    const res = await fetch(C.API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, idToken: S.idToken }, data || {})),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'เกิดข้อผิดพลาด');
    return j.data;
  }
  async function loadDash() { S.dash = await api('dashboard'); return S.dash; }
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
    return out;
  }
  const SETTING_BY_CODE = [[/^อย/, 'Medicine'], [/^ศธ/, 'Orthopedics'], [/^ศศ/, 'Surgery'], [/^กม/, 'Pediatrics'], [/^สน/, 'OB GYN'], [/^จษ/, 'Eye'], [/^สล/, 'ENT'], [/^วฟ/, 'Rehabilitation'], [/^พศก58/, 'Family Medicine'], [/^จว/, 'Psychiatry'], [/^ฉก|^ฉุก/, 'ER']];
  const guessSetting = code => { const h = SETTING_BY_CODE.find(([re]) => re.test(code || '')); return h ? h[1] : ''; };

  // ------------------------------------------------------------ router
  const TITLES = { home: 'Autofill SMARTMED', register: 'ลงทะเบียน', block: 'ตั้งค่าบล็อก', case: 'เคส', cases: 'เคสของฉัน', order: 'สั่งกรอก', admin: 'Admin' };
  function go(page, p, replace) {
    const q = new URLSearchParams(Object.assign({ p: page }, p || {}));
    history[replace ? 'replaceState' : 'pushState'](null, '', location.pathname + '?' + q.toString());
    window.scrollTo(0, 0);
    render();
  }
  window.addEventListener('popstate', render);
  $('#backBtn').onclick = () => { if (history.length > 1) history.back(); else go('home'); };

  async function render() {
    const p = params();
    const page = p.p || 'home';
    $('#title').textContent = TITLES[page] || TITLES.home;
    $('#backBtn').hidden = page === 'home';
    document.querySelectorAll('.sticky-bottom').forEach(n => n.remove());
    if (!S.me.user && page !== 'register' && page !== 'admin') return go('register', {}, true);
    if (page === 'admin' && !S.me.isAdmin) { app.innerHTML = '<div class="empty">ไม่มีสิทธิ์เข้าหน้านี้</div>'; return; }
    app.innerHTML = '<div class="loading">กำลังโหลด…</div>';
    try {
      await (PAGES[page] || PAGES.home)(p);
    } catch (e) {
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
    await loadDash();
    const d = S.dash, blocks = activeBlocks(), archived = d.blocks.filter(b => b.archived === '1');
    const card = b => {
      const cs = d.cases.filter(c => c.blockId === b.blockId);
      const open = cs.filter(c => c.status === 'open'), ready = open.filter(c => !c.missing.length);
      return `<div class="card">
        <div class="between"><div><b>${esc(b.course)}</b> ${esc(b.courseName)}<div class="muted">${range(b.rotStart, b.rotEnd)} · ${esc(optText(O.site, b.site))}</div></div>
        <button class="btn sm ghost" data-edit="${b.blockId}">แก้</button></div>
        <div class="stats"><div><b>${cs.length}</b><span>ทั้งหมด</span></div><div><b>${ready.length}/${open.length}</b><span>ครบ/ยังไม่สั่ง</span></div>
        <div><b>${cs.filter(c => c.status === 'ordered').length}</b><span>สั่งแล้ว</span></div><div><b>${cs.filter(c => c.status === 'filled').length}</b><span>กรอกแล้ว</span></div></div>
        <div class="btns"><button class="btn sm light" data-list="${b.blockId}">ดูเคส</button><button class="btn sm" data-add="${b.blockId}">+ เพิ่มเคส</button>
        ${ready.length ? `<button class="btn sm wine" data-order="${b.blockId}">🚀 สั่งกรอก</button>` : ''}</div></div>`;
    };
    const orders = d.orders.filter(o => o.status !== 'cancelled').slice(0, 5);
    app.innerHTML = `
      ${S.me.isAdmin ? `<div class="card tap" data-go="admin"><div class="between"><b>🛠 หน้า Admin</b><span>›</span></div></div>` : ''}
      <h2>บล็อก / rotation</h2>
      ${blocks.length ? blocks.map(card).join('') : `<div class="card empty">ยังไม่มีบล็อก<br><span class="small">ตั้งค่าบล็อกครั้งเดียวต่อ rotation แล้วเพิ่มเคสได้เรื่อย ๆ</span><div class="btns"><button class="btn" data-go="block">⚙️ ตั้งค่าบล็อกแรก</button></div></div>`}
      ${blocks.length ? `<button class="btn ghost block" data-go="block">+ เพิ่มบล็อกใหม่</button>` : ''}
      ${orders.length ? `<h2>งานสั่งกรอก</h2><div class="card">${orders.map(o => {
        const b = blockById(o.blockId) || {};
        return `<div class="list-item"><div class="between"><div><b class="mono">${esc(o.orderId)}</b><div class="muted">${esc(b.course || '')} · ${o.caseCount} เคส${Number(o.amount) ? ' · ' + o.amount + ' บาท' : ''}</div>
          ${o.note ? `<div class="miss">${esc(o.note)}</div>` : ''}</div><span class="badge ${STATUS_BADGE[o.status] || ''}">${esc(o.statusText)}</span></div>
          ${o.status === 'pending_slip' ? `<div class="btns"><button class="btn sm wine" data-pay="${o.orderId}">ชำระเงิน / ดู QR</button></div>` : ''}</div>`;
      }).join('')}</div>` : ''}
      ${archived.length ? `<details><summary>บล็อกที่เก็บแล้ว (${archived.length})</summary>${archived.map(card).join('')}</details>` : ''}
      <p class="muted small" style="text-align:center;margin-top:24px">${esc(S.me.user.fullName)} · ปี ${esc(S.me.user.year)} · <a href="#" data-go="register">แก้ข้อมูล</a></p>`;
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
    if (blocks.length) bottom(`<button class="btn" id="bAdd">+ เพิ่มเคส</button><button class="btn wine" id="bOrder">🚀 สั่งกรอก</button>`);
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
        toast('บันทึกแล้ว'); go('home', {}, true);
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    };
  };

  // ------------------------------------------------------------ ตั้งค่าบล็อก
  PAGES.block = async function (p) {
    if (!S.dash) await loadDash();
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
    <h2>ค่าเริ่มต้นของทุกเคสในบล็อกนี้</h2>
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
    ${b ? `<button class="btn ghost block" id="arch">${b.archived === '1' ? 'นำบล็อกกลับมาใช้' : 'เก็บบล็อกนี้ (จบ rotation แล้ว)'}</button>` : ''}`;
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
      try { await api('archiveBlock', { blockId: b.blockId, archived: b.archived !== '1' }); await loadDash(); toast('เรียบร้อย'); go('home', {}, true); }
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
        await loadDash(); toast('บันทึกบล็อกแล้ว');
        if (b) go('home', {}, true); else go('case', { block: saved.blockId }, true);
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    };
  };

  // ------------------------------------------------------------ เพิ่ม/แก้เคส
  PAGES.case = async function (p) {
    if (!S.dash) await loadDash();
    fillAdvisorList();
    const blocks = activeBlocks();
    const editing = p.id ? S.dash.cases.find(c => c.caseId === p.id) : null;
    if (p.id && !editing) throw new Error('ไม่พบเคส');
    if (!blocks.length && !editing) {
      app.onclick = null;
      app.innerHTML = `<div class="card empty">ต้องตั้งค่าบล็อกก่อนเพิ่มเคส<div class="btns"><button class="btn" id="gb">⚙️ ตั้งค่าบล็อก</button></div></div>`;
      $('#gb').onclick = () => go('block', {}, true);
      return;
    }
    $('#title').textContent = editing ? 'แก้เคส' : 'เพิ่มเคส';
    const locked = editing && editing.status !== 'open';
    let blockId = editing ? editing.blockId : (p.block && blockById(p.block) ? p.block : (blockById(store.get('lastBlock')) && blockById(store.get('lastBlock')).archived !== '1' ? store.get('lastBlock') : blocks[0].blockId));
    const v = Object.assign({ ptType: store.get('lastPt', 'ผู้ป่วยใน'), hn: '', careStart: '', careEnd: '', diagnosis: '', icd10: '', diseaseGroup: '', detail: '', advisor: '', setting: '', category: '', complexity: '' }, editing || {});
    let icdAuto = false, dgAuto = !v.diseaseGroup, ptType = v.ptType;
    const blockList = editing && !blocks.some(b => b.blockId === blockId) ? blocks.concat([blockById(blockId)]) : blocks;

    app.onclick = null;
    app.innerHTML = `
      ${locked ? `<div class="warnbox">เคสนี้อยู่ในงาน ${esc(editing.orderId)} แล้ว — แก้ไม่ได้ (ถ้าต้องแก้ ให้ยกเลิกงานก่อน)</div>` : ''}
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
      <div class="warnbox" id="missBox" hidden></div>
      ${editing && !locked ? `<button class="btn ghost block" id="del" style="color:var(--bad);border-color:var(--bad)">ลบเคสนี้</button>` : ''}`;

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
      $('#missBox').textContent = 'ยังขาด: ' + m.join(', ') + ' — บันทึกไว้ก่อนได้ แต่จะสั่งกรอกได้เมื่อครบ';
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
      try { await api('deleteCase', { caseId: editing.caseId }); await loadDash(); toast('ลบแล้ว'); history.back(); } catch (err) { toast(err.message, true); }
    };
    if (locked) return;

    async function save(btn, again, allowDuplicate) {
      const c = current();
      if (!c.hn) return toast('กรอก HN', true);
      if (!checkAdvisor($('#advisor'))) return toast('ชื่ออาจารย์ต้องเลือกจากรายการ', true);
      busy(btn, true);
      try {
        const saved = await api('saveCase', { case: c, allowDuplicate: !!allowDuplicate });
        store.set('lastBlock', c.blockId); store.set('lastPt', c.ptType);
        await loadDash();
        toast(saved.missing.length ? `บันทึกแล้ว (ยังขาด ${saved.missing.length} ช่อง)` : 'บันทึกแล้ว ✓ ครบทุกช่อง');
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
    await loadDash();
    const d = S.dash;
    const blocks = d.blocks.slice().reverse();
    let bid = p.block || (activeBlocks()[0] || {}).blockId || '';
    function draw() {
      const b = blockById(bid);
      const cs = d.cases.filter(c => c.blockId === bid).sort((a, x) => (x.careStart || '').localeCompare(a.careStart || ''));
      const badge = c => c.status === 'filled' ? '<span class="badge ok">กรอกแล้ว ✓</span>' : c.status === 'ordered' ? '<span class="badge">สั่งแล้ว</span>'
        : c.missing.length ? `<span class="badge warn">ขาด ${c.missing.length}</span>` : '<span class="badge ok">ครบ</span>';
      app.innerHTML = `
        <select id="bsel">${blocks.map(x => `<option value="${x.blockId}"${x.blockId === bid ? ' selected' : ''}>${esc(x.course)} ${esc(x.courseName)}${x.archived === '1' ? ' (เก็บแล้ว)' : ''}</option>`).join('')}</select>
        <div class="muted small" style="margin:6px 0 10px">${b ? range(b.rotStart, b.rotEnd) + ' · ' + cs.length + ' เคส' : ''}</div>
        ${cs.length ? `<div class="card">${cs.map(c => `<div class="list-item tap" data-id="${c.caseId}" style="cursor:pointer">
          <div class="between"><div><b>HN ${esc(c.hn)}</b> <span class="muted">· ${esc(c.ptType === 'ผู้ป่วยนอก' ? 'OPD' : 'IPD')} · ${range(c.careStart, c.careEnd)}</span>
          <div>${esc(c.diagnosis || '—')} ${c.icd10 ? `<span class="muted mono">(${esc(c.icd10)})</span>` : ''}</div>
          ${c.status === 'open' && c.missing.length ? `<div class="miss">ขาด: ${esc(c.missing.join(', '))}</div>` : ''}</div>${badge(c)}</div></div>`).join('')}</div>`
          : `<div class="card empty">ยังไม่มีเคสในบล็อกนี้</div>`}`;
      $('#bsel').onchange = () => { bid = $('#bsel').value; history.replaceState(null, '', '?p=cases&block=' + bid); draw(); };
    }
    if (!blocks.length) { app.innerHTML = '<div class="card empty">ยังไม่มีบล็อก</div>'; return; }
    draw();
    app.onclick = e => { const t = e.target.closest('[data-id]'); if (t) go('case', { id: t.dataset.id }); };
    bottom(`<button class="btn" id="add">+ เพิ่มเคส</button><button class="btn wine" id="ord">🚀 สั่งกรอก</button>`);
    $('#add').onclick = () => go('case', { block: bid });
    $('#ord').onclick = () => go('order', { block: bid });
  };

  // ------------------------------------------------------------ สั่งกรอก + ชำระเงิน
  PAGES.order = async function (p) {
    await loadDash();
    if (p.o) return payView(p.o);
    const d = S.dash;
    const blocks = activeBlocks().filter(b => d.cases.some(c => c.blockId === b.blockId && c.status === 'open'));
    if (!blocks.length) { app.onclick = null; app.innerHTML = '<div class="card empty">ยังไม่มีเคสที่รอสั่งกรอก<br><span class="small">เพิ่มเคสก่อน แล้วค่อยกลับมาสั่ง</span></div>'; return; }
    let bid = blocks.some(b => b.blockId === p.block) ? p.block : blocks[0].blockId;
    const pay = S.me.pay;
    app.onclick = null;
    app.innerHTML = `<div class="card"><label>เลือกบล็อก</label><select id="bsel">${blocks.map(b => `<option value="${b.blockId}"${b.blockId === bid ? ' selected' : ''}>${esc(b.course)} ${esc(b.courseName)}</option>`).join('')}</select><div id="sum"></div></div>
      <h2>บัญชี SMART</h2>
      <div class="card">
        <div class="muted small">ทีมงานใช้บัญชีนี้ login เข้า SMART เพื่อกรอกเคสตามรายการด้านบนเท่านั้น และลบออกจากระบบเมื่องานเสร็จ</div>
        <label>Username <span class="req">*</span></label><input id="su" autocomplete="off" autocapitalize="off" spellcheck="false">
        <label>Password <span class="req">*</span></label><div class="row"><input id="sp" type="password" autocomplete="off"><button type="button" class="btn sm ghost" id="eye" style="flex:0 0 auto">แสดง</button></div>
        <label class="check"><input type="checkbox" id="agree"> ยินยอมให้ทีมงานใช้บัญชีนี้กรอกเคสให้</label>
      </div>`;
    function sum() {
      const b = blockById(bid);
      const open = d.cases.filter(c => c.blockId === bid && c.status === 'open');
      const ready = open.filter(c => !c.missing.length), notReady = open.filter(c => c.missing.length);
      const pend = d.orders.find(o => o.blockId === bid && ['pending_slip', 'slip_review'].includes(o.status));
      const price = Math.max(pay.minPrice, ready.length * pay.pricePerCase);
      $('#sum').innerHTML = `<div class="muted small" style="margin-top:6px">${range(b.rotStart, b.rotEnd)} · ${esc(optText(O.site, b.site))}</div>
        ${pend ? `<div class="warnbox">บล็อกนี้มีงาน ${esc(pend.orderId)} ที่ยัง${esc(pend.statusText)}อยู่ <a href="#" data-pay="${pend.orderId}">ดูงาน</a></div>` : ''}
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
    $('#eye').onclick = () => { const i = $('#sp'); i.type = i.type === 'password' ? 'text' : 'password'; $('#eye').textContent = i.type === 'password' ? 'แสดง' : 'ซ่อน'; };
    $('#go').onclick = async e => {
      if (!$('#su').value.trim() || !$('#sp').value) return toast('กรอก username / password ของ SMART', true);
      if (!$('#agree').checked) return toast('ติ๊กยินยอมก่อน', true);
      busy(e.target, true);
      try {
        const r = await api('createOrder', { blockId: bid, smartUser: $('#su').value.trim(), smartPass: $('#sp').value });
        $('#sp').value = '';
        toast('สร้างงานแล้ว'); go('order', { o: r.order.orderId }, true);
      } catch (err) { toast(err.message, true); busy(e.target, false); }
    };
  };

  function payView(orderId) {
    const o = S.dash.orders.find(x => x.orderId === orderId);
    if (!o) throw new Error('ไม่พบงาน');
    const b = blockById(o.blockId) || {};
    const pay = S.me.pay, amt = Number(o.amount);
    let qr = '';
    if (pay.promptpayId && o.status === 'pending_slip') {
      const q = qrcode(0, 'M'); q.addData(PromptPay.payload(pay.promptpayId, amt)); q.make();
      qr = `<div class="pp-head">PromptPay</div><div class="qr">${q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
        <div style="text-align:center"><b>${esc(pay.promptpayName)}</b><div class="muted small">${esc(pay.promptpayId)}</div></div>`;
    }
    app.onclick = null;
    app.innerHTML = `<div class="card"><div class="between"><div><b class="mono">${esc(o.orderId)}</b><div class="muted">${esc(b.course || '')} ${esc(b.courseName || '')} · ${o.caseCount} เคส</div></div>
      <span class="badge ${STATUS_BADGE[o.status] || ''}">${esc(o.statusText)}</span></div>
      ${o.note ? `<div class="warnbox">${esc(o.note)}</div>` : ''}</div>
      ${o.status === 'pending_slip' ? `
        <div class="card">
          <div style="text-align:center">${amt ? `<div class="muted">ยอดชำระ</div><div class="big">${amt.toLocaleString()} บาท</div>` : '<div class="muted">โอนตามยอดที่ตกลงกับทีมงาน</div>'}</div>
          ${qr || '<div class="warnbox">ยังไม่ได้ตั้งค่าบัญชีรับเงิน — ติดต่อทีมงาน</div>'}
          ${pay.note ? `<div class="infobox">${esc(pay.note)}</div>` : ''}
          <div class="infobox"><b>ขั้นต่อไป:</b> แคปหน้าจอ QR นี้ → โอนผ่านแอปธนาคาร → <b>ส่งรูปสลิปในแชท LINE นี้</b> ระบบจะผูกสลิปกับงานให้เอง</div>
        </div>` : ''}
      ${o.status === 'slip_review' ? '<div class="infobox">ได้รับสลิปแล้ว รอทีมงานตรวจ จะแจ้งในแชทครับ</div>' : ''}
      ${o.status === 'paid' || o.status === 'in_progress' ? '<div class="infobox">ชำระเงินแล้ว งานอยู่ในคิวกรอก</div>' : ''}
      ${o.status === 'pending_slip' ? '<button class="btn ghost block" id="cancel">ยกเลิกงานนี้</button>' : ''}`;
    const inLine = window.liff && liff.isInClient && liff.isInClient();
    if (o.status === 'pending_slip' || o.status === 'slip_review') {
      bottom(`<button class="btn" id="chat">${inLine ? 'กลับไปแชทเพื่อส่งสลิป' : 'กลับหน้าแรก'}</button>`);
      $('#chat').onclick = () => { if (inLine) liff.closeWindow(); else go('home'); };
    }
    if ($('#cancel')) $('#cancel').onclick = async () => {
      if (!confirm('ยกเลิกงาน ' + o.orderId + ' ? เคสจะกลับไปอยู่ในรายการ')) return;
      try { await api('cancelOrder', { orderId: o.orderId }); toast('ยกเลิกแล้ว'); go('home', {}, true); } catch (err) { toast(err.message, true); }
    };
  }

  // ------------------------------------------------------------ Admin
  const ADMIN_FILTERS = [['active', 'งานค้าง'], ['slip_review', 'รอตรวจสลิป'], ['paid', 'รอกรอก'], ['in_progress', 'กำลังกรอก'], ['done', 'เสร็จแล้ว'], ['', 'ทั้งหมด']];
  PAGES.admin = async function (p) {
    if (p.o) return adminOrder(p.o);
    const f = p.f == null ? 'active' : p.f;
    const list = await api('adminOrders', { status: f });
    const inLine = window.liff && liff.isInClient && liff.isInClient();
    const order = { slip_review: 0, paid: 1, in_progress: 2, pending_slip: 3 };
    if (f === 'active') list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    app.innerHTML = `
      ${inLine ? `<div class="infobox">ดาวน์โหลด CSV สะดวกกว่าบนคอม — <a href="#" id="ext">เปิดในเบราว์เซอร์</a></div>` : ''}
      <div class="filters">${ADMIN_FILTERS.map(([k, t]) => `<button class="chip${k === f ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
      ${list.length ? list.map(o => `<div class="card tap" data-o="${esc(o.orderId)}">
        <div class="between"><div><b class="mono">${esc(o.orderId)}</b> <span class="badge ${STATUS_BADGE[o.status] || ''}">${esc(o.statusText)}</span>
        <div><b>${esc(o.userName)}</b> <span class="muted">ปี ${esc(o.year)}${o.studentId ? ' · ' + esc(o.studentId) : ''}</span></div>
        <div class="muted small">${esc(o.course)} ${esc(o.courseName)} · ${o.caseCount} เคส · ${Number(o.amount) || 0} บาท</div>
        ${o.assignee ? `<div class="muted small">👤 ${esc(o.assignee)}</div>` : ''}</div><span>›</span></div></div>`).join('') : '<div class="card empty">ไม่มีงาน</div>'}`;
    app.onclick = e => {
      const c = e.target.closest('[data-f]'); if (c) return go('admin', { f: c.dataset.f }, true);
      const t = e.target.closest('[data-o]'); if (t) return go('admin', { o: t.dataset.o });
      if (e.target.id === 'ext') { e.preventDefault(); liff.openWindow({ url: location.href, external: true }); }
    };
  };

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
        <div class="list-item"><b>${esc(b.course)}</b> ${esc(b.courseName)}<div class="muted small">rotation ${range(b.rotStart, b.rotEnd)} · ${esc(optText(O.site, b.site))} · ${esc(b.setting)} · log book ${b.logBook === '1' ? '✓' : '✗'} · EPA ${b.epa === '1' ? '✓' : '✗'}</div></div>
        <div class="muted small">${o.caseCount} เคส · ${Number(o.amount) || 0} บาท · สร้าง ${esc(o.createdAt)}${o.slipAt ? ' · สลิป ' + esc(o.slipAt) : ''}${o.approvedBy ? ' · อนุมัติโดย ' + esc(o.approvedBy) : ''}${o.assignee ? ' · 👤 ' + esc(o.assignee) : ''}</div>
        ${o.note ? `<div class="warnbox">${esc(o.note)}</div>` : ''}</div>

      ${o.slipFileId ? `<div class="card slip"><div class="between"><b>สลิป</b><button class="btn sm light" id="loadSlip">ดูสลิป</button></div><div id="slipBox"></div></div>` : ''}

      <div class="card"><b>ดำเนินการ</b><div class="btns">
        ${st === 'slip_review' ? btn('approve', 'green', '✅ สลิปถูกต้อง') + btn('reject', 'ghost', '❌ ไม่ผ่าน') : ''}
        ${st === 'pending_slip' ? btn('approve', 'ghost', 'อนุมัติโดยไม่มีสลิป') : ''}
        ${st === 'paid' ? btn('claim', '', '🙋 รับงานนี้') : ''}
        ${st === 'paid' || st === 'in_progress' ? btn('done', 'green', '✔ กรอกเสร็จแล้ว (ปิดงาน)') : ''}
        ${st === 'in_progress' ? btn('release', 'ghost', 'ปล่อยงาน') : ''}
      </div></div>

      ${st === 'paid' || st === 'in_progress' ? `<div class="card"><b>ไฟล์และบัญชี</b>
        <div class="btns">${btn('dl', '', '⬇️ ดาวน์โหลด CSV')}${btn('copy', 'light', 'คัดลอก CSV')}</div>
        <div class="btns">${d.hasCred ? btn('cred', 'wine', '🔑 แสดงบัญชี SMART') : '<span class="muted">ไม่มีข้อมูลบัญชี</span>'}</div><div id="credBox"></div>
        <div class="infobox small"><b>ขั้นตอนกรอก</b><br>1) เปิด Chrome profile สำหรับลูกค้า → login SMART ด้วยบัญชีด้านบน<br>2) เปิดเมนู "บันทึกผู้ป่วยใน/ผู้ป่วยนอก"<br>3) Autofill StupidMED → นำเข้า CSV → ตรวจ → รันออโต้<br>4) ตรวจในตาราง SMART ครบ → logout → กด "กรอกเสร็จแล้ว"</div></div>` : ''}

      <div class="card"><b>เคส (${d.cases.length})</b>
        <table class="cases"><tr><th>#</th><th>HN / วันที่</th><th>Dx / ICD</th><th>อาจารย์</th></tr>
        ${d.cases.map((c, i) => `<tr><td>${i + 1}</td><td><b>${esc(c.hn)}</b><br><span class="muted">${esc(c.ptType === 'ผู้ป่วยนอก' ? 'OPD' : 'IPD')} ${range(c.careStart, c.careEnd)}</span></td>
          <td>${esc(c.diagnosis)}<br><span class="mono muted">${esc(c.icd10)} · กลุ่ม ${esc(c.diseaseGroup)}</span>${c.missing.length ? `<div class="miss">ขาด: ${esc(c.missing.join(', '))}</div>` : ''}</td>
          <td class="small">${esc(c.advisor || b.advisor)}</td></tr>`).join('')}</table></div>
      ${st !== 'done' && st !== 'cancelled' ? `<button class="btn ghost block" id="cancel" style="color:var(--bad);border-color:var(--bad)">ยกเลิกงาน (คืนเคสให้ผู้ใช้)</button>` : ''}`;

    const act = (id, fn) => { const n = $('#' + id); if (n) n.onclick = async () => { try { n.disabled = true; await fn(); } catch (err) { toast(err.message, true); n.disabled = false; } }; };
    const reload = () => go('admin', { o: orderId }, true);
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
      $('#credBox').innerHTML = `<div class="cred" style="margin-top:10px"><div class="muted small" style="color:#a0aec0">Username</div><div class="between"><span class="mono">${esc(c.smartUser)}</span><button class="btn sm light" data-cp="u">คัดลอก</button></div>
        <div class="muted small" style="color:#a0aec0;margin-top:8px">Password</div><div class="between"><span class="mono">${esc(c.smartPass)}</span><button class="btn sm light" data-cp="p">คัดลอก</button></div></div>`;
      $('#credBox').onclick = async e => { const t = e.target.closest('[data-cp]'); if (t) { await navigator.clipboard.writeText(t.dataset.cp === 'u' ? c.smartUser : c.smartPass); toast('คัดลอกแล้ว'); } };
    });
    if (st === 'slip_review' && $('#loadSlip')) $('#loadSlip').click();
  }

  // ------------------------------------------------------------ boot
  async function boot() {
    try {
      if (C.MOCK_LIFF) {
        const uid = new URLSearchParams(location.search).get('mockUser') || store.get('mockUser', 'Ustu');
        store.set('mockUser', uid);
        window.liff = { init: async () => {}, isLoggedIn: () => true, getIDToken: () => 'mock:' + uid + ':' + uid, isInClient: () => false, closeWindow: () => {}, openWindow: o => window.open(o.url) };
      }
      await liff.init({ liffId: C.LIFF_ID });
      if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
      S.idToken = liff.getIDToken();
      S.me = await api('me');
      $('#who').textContent = S.me.user ? S.me.user.fullName.split(' ')[0] : '';
      render();
    } catch (e) {
      app.innerHTML = `<div class="card"><b>เปิดไม่สำเร็จ</b><div class="muted">${esc(e.message)}</div><div class="btns"><button class="btn" onclick="location.reload()">ลองใหม่</button></div></div>`;
    }
  }
  boot();
})();
