import { firebaseConfig, APP } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, onSnapshot, runTransaction, writeBatch,
  serverTimestamp, query, where, getDocs, setDoc, limit
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

const S = { me: null, docs: [], members: [], tab: 'overview', unsub: [] };

/* ---------- ตัวช่วย ---------- */
const $ = (id) => document.getElementById(id);
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toDate(t) { return t && typeof t.toDate === 'function' ? t.toDate() : null; }
function fmt(t) { const d = toDate(t); return d ? d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'; }
function ms(t) { const d = toDate(t); return d ? d.getTime() : 0; }
function daysSince(t) { const d = toDate(t); return d ? Math.floor((Date.now() - d.getTime()) / 86400000) : 0; }
const isDone = (d) => d.step === APP.doneStep;
function stepClass(step) { if (step === APP.doneStep) return 'done'; if (step === APP.steps[0]) return 'todo'; return ''; }
function busy(on) { $('loading').classList.toggle('hidden', !on); }
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2600); }
function errText(e) {
  const code = (e && e.code) || '';
  if (code === 'permission-denied') return 'คุณไม่มีสิทธิ์ทำรายการนี้';
  if (code === 'unavailable') return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจอินเทอร์เน็ต';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/popup-blocked') return 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน กรุณาอนุญาตป๊อปอัปแล้วลองใหม่';
  if (code === 'auth/unauthorized-domain') return 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase (Authentication → Settings → Authorized domains)';
  return (e && e.message) || String(e);
}
function roleText(m) {
  if (m.isAdmin) return 'ผู้ดูแลระบบ';
  const p = []; if (m.canAdd) p.push('เพิ่ม'); if (m.canEdit) p.push('แก้ไข'); if (m.canDelete) p.push('ลบ');
  return p.length ? 'สิทธิ์: ' + p.join(' / ') : 'ดูอย่างเดียว';
}
document.querySelectorAll('.appTitle').forEach(el => el.textContent = APP.name);
document.title = APP.name;

/* ---------- เข้าสู่ระบบ ---------- */
$('btnGoogle').onclick = async () => {
  $('loginErr').textContent = '';
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) { $('loginErr').textContent = errText(e); }
};
$('btnLogout').onclick = () => signOut(auth);
$('btnPendingOut').onclick = () => signOut(auth);

function stopListeners() { S.unsub.forEach(u => u()); S.unsub = []; }

function showScreen(name) {
  $('login').classList.toggle('hidden', name === 'app');
  $('app').classList.toggle('hidden', name !== 'app');
  $('loginBox').classList.toggle('hidden', name !== 'login');
  $('pendingBox').classList.toggle('hidden', name !== 'pending');
}

onAuthStateChanged(auth, async (user) => {
  stopListeners(); closeModal(); S.me = null;
  if (!user) { busy(false); showScreen('login'); return; }
  busy(true);
  try {
    const email = (user.email || '').toLowerCase();
    let m = null;
    const snap = await getDoc(doc(db, 'members', email));
    if (snap.exists()) m = snap.data();
    // ผู้ดูแลหลักกำหนดไว้ในกฎความปลอดภัยของ Firebase (ไม่อยู่ในโค้ดสาธารณะ)
    // ถ้าไม่ใช่สมาชิก ให้ลองอ่านข้อมูล: อ่านได้แปลว่าเป็นผู้ดูแลหลัก
    let owner = false;
    if (!m || !m.active) {
      try { await getDocs(query(collection(db, 'meta'), limit(1))); owner = true; }
      catch (e) { if (e && e.code !== 'permission-denied') throw e; }
    }
    if (!owner && (!m || !m.active)) {
      $('pendingEmail').textContent = email; showScreen('pending'); busy(false); return;
    }
    const admin = owner || !!(m && m.isAdmin);
    S.me = {
      email, owner, isAdmin: admin,
      displayName: (m && m.displayName) || user.displayName || email,
      canAdd: admin || !!(m && m.canAdd), canEdit: admin || !!(m && m.canEdit), canDelete: admin || !!(m && m.canDelete)
    };
    setupUI(); showScreen('app'); startListeners();
  } catch (e) {
    $('loginErr').textContent = errText(e); showScreen('login'); busy(false);
  }
});

function startListeners() {
  let first = true;
  S.unsub.push(onSnapshot(collection(db, 'docs'), (qs) => {
    S.docs = qs.docs.map(d => Object.assign({ id: d.id }, d.data({ serverTimestamps: 'estimate' })));
    render();
    if (first) { first = false; busy(false); }
  }, (e) => { busy(false); toast(errText(e)); }));
  S.unsub.push(onSnapshot(collection(db, 'members'), (qs) => {
    S.members = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
    if (S.tab === 'users') renderUsers();
  }, () => { /* ผู้ใช้ทั่วไปอาจอ่านรายชื่อไม่ได้ ไม่เป็นไร */ }));
}

/* ---------- โครงหน้า ---------- */
let uiReady = false;
function setupUI() {
  $('meName').textContent = S.me.displayName;
  $('meRole').textContent = S.me.owner ? 'ผู้ดูแลหลัก' : roleText(S.me);
  $('btnNew').classList.toggle('hidden', !S.me.canAdd);
  $('tabUsers').classList.toggle('hidden', !S.me.isAdmin);
  if (!S.me.isAdmin && S.tab === 'users') switchTab('overview');
  $('fp').innerHTML = '<option value="">ทั้งหมด</option>' + APP.priorities.map(p => `<option>${esc(p)}</option>`).join('');
  $('fs').innerHTML = '<option value="">ทั้งหมด</option>' + APP.steps.map(p => `<option>${esc(p)}</option>`).join('');
  if (!uiReady) {
    uiReady = true;
    document.querySelectorAll('.tab').forEach(b => { b.onclick = () => switchTab(b.dataset.tab); });
    ['fq', 'fp', 'fs', 'fh', 'fd'].forEach(id => { $(id).addEventListener('input', renderList); $(id).addEventListener('change', renderList); });
    $('btnNew').onclick = openNew;
    $('btnAddUser').onclick = () => openUser(null);
  }
}
function holders() {
  const set = new Set(); S.docs.forEach(d => { if (d.holder) set.add(d.holder); });
  return [...set].sort((a, b) => a.localeCompare(b, 'th'));
}
function switchTab(t) {
  S.tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  ['overview', 'list', 'users'].forEach(v => $('v-' + v).classList.toggle('hidden', v !== t));
  if (t === 'users') renderUsers();
}
function render() {
  const fh = $('fh').value, hs = holders();
  $('fh').innerHTML = '<option value="">ทุกคน</option>' + hs.map(p => `<option>${esc(p)}</option>`).join('');
  $('fh').value = hs.includes(fh) ? fh : '';
  renderOverview(); renderList();
}

/* ---------- ภาพรวม ---------- */
function renderOverview() {
  const open = S.docs.filter(d => !isDone(d));
  $('sOpen').textContent = open.length;
  $('sUrgent').textContent = open.filter(d => d.priority === APP.priorities[0]).length;
  $('sImportant').textContent = open.filter(d => d.priority === APP.priorities[1]).length;
  $('sDone').textContent = S.docs.length - open.length;
  const max = Math.max(1, S.docs.length);
  $('byStep').innerHTML = APP.steps.map(s => {
    const n = S.docs.filter(d => d.step === s).length;
    const color = s === APP.doneStep ? 'var(--done)' : 'var(--primary)';
    return `<div class="bar-row"><div>${esc(s)}</div><div class="bar"><span style="width:${n / max * 100}%;background:${color}"></span></div><div style="text-align:right;font-weight:600">${n}</div></div>`;
  }).join('');
  const map = {};
  open.forEach(d => { const h = d.holder || '(ยังไม่ระบุ)'; map[h] = map[h] || { n: 0, u: 0 }; map[h].n++; if (d.priority === APP.priorities[0]) map[h].u++; });
  const rows = Object.keys(map).sort((a, b) => map[b].n - map[a].n);
  $('byHolder').innerHTML = rows.length ? rows.map(h =>
    `<tr class="click" data-h="${esc(h)}"><td>${esc(h)}</td><td><b>${map[h].n}</b></td><td>${map[h].u ? `<span class="badge p-ด่วนมาก">${map[h].u}</span>` : '-'}</td></tr>`
  ).join('') : '<tr><td colspan="3" class="empty" style="padding:20px">ไม่มีงานค้าง</td></tr>';
  $('byHolder').querySelectorAll('tr.click').forEach(tr => {
    tr.onclick = () => {
      const h = tr.dataset.h;
      $('fq').value = ''; $('fp').value = ''; $('fs').value = ''; $('fd').checked = true;
      $('fh').value = h === '(ยังไม่ระบุ)' ? '' : h;
      switchTab('list'); renderList();
    };
  });
}

/* ---------- รายการ ---------- */
function renderList() {
  const q = $('fq').value.trim().toLowerCase(), p = $('fp').value, s = $('fs').value, h = $('fh').value, hideDone = $('fd').checked;
  const list = S.docs.filter(d => {
    if (hideDone && isDone(d)) return false;
    if (p && d.priority !== p) return false;
    if (s && d.step !== s) return false;
    if (h && d.holder !== h) return false;
    if (q && [d.id, d.docNo, d.title, d.holder, d.lastNote].join(' ').toLowerCase().indexOf(q) < 0) return false;
    return true;
  }).sort((a, b) => {
    const da = isDone(a) ? 1 : 0, dbb = isDone(b) ? 1 : 0; if (da !== dbb) return da - dbb;
    const pa = APP.priorities.indexOf(a.priority), pb = APP.priorities.indexOf(b.priority); if (pa !== pb) return pa - pb;
    return ms(a.createdAt) - ms(b.createdAt);
  });
  $('countText').textContent = 'พบ ' + list.length + ' รายการ';
  $('items').innerHTML = list.length ? list.map(itemHtml).join('') : '<div class="empty card">ไม่พบเอกสารตามเงื่อนไข</div>';
  $('items').querySelectorAll('.item').forEach(el => { el.onclick = () => openDetail(el.dataset.id); });
}
function itemHtml(d) {
  const age = isDone(d) ? 0 : daysSince(d.createdAt);
  return `<div class="item pr-${esc(d.priority)}${isDone(d) ? ' is-done' : ''}" data-id="${esc(d.id)}">` +
    `<div class="row1"><span class="badge p-${esc(d.priority)}">${esc(d.priority)}</span>` +
    `<span class="stepchip ${stepClass(d.step)}">${esc(d.step)}</span>` +
    `<span class="id">${esc(d.id)}${d.docNo ? ' · ' + esc(d.docNo) : ''}</span>` +
    (age > 0 ? `<span class="age">ค้าง ${age} วัน</span>` : '') + '</div>' +
    `<div class="title">${esc(d.title)}</div>` +
    `<div class="meta"><span>อยู่ที่ <b>${esc(d.holder || '-')}</b></span><span>อัปเดต ${fmt(d.updatedAt)} โดย ${esc(d.updatedBy)}</span></div>` +
    (d.lastNote ? `<div class="note">${esc(d.lastNote)}</div>` : '') + '</div>';
}

/* ---------- หน้าต่าง ---------- */
function openModal(html) {
  $('modalRoot').innerHTML = `<div class="modal-bg" id="mbg"><div class="modal">${html}</div></div>`;
  $('mbg').addEventListener('mousedown', e => { if (e.target.id === 'mbg') closeModal(); });
  $('modalRoot').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
}
function closeModal() { $('modalRoot').innerHTML = ''; }
const opts = (arr, sel) => arr.map(x => `<option${x === sel ? ' selected' : ''}>${esc(x)}</option>`).join('');
function peopleList() {
  const set = new Set(S.members.filter(m => m.active).map(m => m.displayName).concat(holders()));
  return '<datalist id="dlPeople">' + [...set].filter(Boolean).map(p => `<option value="${esc(p)}">`).join('') + '</datalist>';
}
function onSubmit(form, fn) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'), err = form.querySelector('.err');
    btn.disabled = true; err.textContent = '';
    try { await fn(); } catch (x) { err.textContent = errText(x); btn.disabled = false; }
  });
}
const val = (f, n) => String(f.elements[n].value || '').trim();
function histRef() { return doc(collection(db, 'history')); }
function hist(docId, action, step, holder, note) {
  return { docId, action, step, holder, note: note.slice(0, 1500), by: S.me.displayName, byEmail: S.me.email, time: serverTimestamp() };
}

/* ลงทะเบียน */
function openNew() {
  openModal('<h3>ลงทะเบียนเอกสาร</h3><form id="fNew">' +
    `<div class="grid2"><div class="field"><label class="f">เลขที่หนังสือ (ถ้ามี)</label><input class="in" name="docNo" maxlength="100"></div>` +
    `<div class="field"><label class="f">ความสำคัญ</label><select class="in" name="priority">${opts(APP.priorities, APP.priorities[2])}</select></div></div>` +
    '<div class="field"><label class="f">ชื่อเรื่อง *</label><input class="in" name="title" required maxlength="300"></div>' +
    `<div class="grid2"><div class="field"><label class="f">ขั้นตอน</label><select class="in" name="step">${opts(APP.steps, APP.steps[0])}</select></div>` +
    '<div class="field"><label class="f">ตอนนี้อยู่ที่ใคร</label><input class="in" name="holder" list="dlPeople" maxlength="100"></div></div>' +
    '<div class="field"><label class="f">รายละเอียดการดำเนินการ</label><textarea class="in" name="note" maxlength="1000"></textarea></div>' +
    peopleList() + '<div class="err"></div>' +
    '<div class="acts"><button type="button" class="btn" data-close>ยกเลิก</button><button type="submit" class="btn primary">บันทึก</button></div></form>');
  const f = $('fNew');
  onSubmit(f, async () => {
    const title = val(f, 'title');
    if (!title) throw new Error('กรุณากรอกชื่อเรื่อง');
    const data = {
      docNo: val(f, 'docNo'), title, priority: val(f, 'priority'), step: val(f, 'step'),
      holder: val(f, 'holder'), lastNote: val(f, 'note'),
      createdBy: S.me.displayName, createdByEmail: S.me.email, createdAt: serverTimestamp(),
      updatedBy: S.me.displayName, updatedByEmail: S.me.email, updatedAt: serverTimestamp()
    };
    const year = new Date().getFullYear() + 543;
    const counter = doc(db, 'meta', 'c' + year);
    const id = await runTransaction(db, async tx => {
      const c = await tx.get(counter);
      const n = (c.exists() ? c.data().last : 0) + 1;
      const newId = `DOC-${year}-${String(n).padStart(4, '0')}`;
      tx.set(counter, { last: n });
      tx.set(doc(db, 'docs', newId), data);
      tx.set(histRef(), hist(newId, 'ลงทะเบียนเอกสาร', data.step, data.holder, data.lastNote));
      return newId;
    });
    closeModal(); toast('ลงทะเบียน ' + id + ' แล้ว');
  });
}

/* รายละเอียด */
function docData(d) {
  return {
    docNo: d.docNo || '', title: d.title, priority: d.priority, step: d.step, holder: d.holder || '', lastNote: d.lastNote || '',
    createdBy: d.createdBy, createdByEmail: d.createdByEmail, createdAt: d._rawCreatedAt,
    updatedBy: S.me.displayName, updatedByEmail: S.me.email, updatedAt: serverTimestamp()
  };
}
async function freshDoc(id) {
  const snap = await getDoc(doc(db, 'docs', id));
  if (!snap.exists()) throw new Error('ไม่พบเอกสารนี้ (อาจถูกลบไปแล้ว)');
  const d = Object.assign({ id }, snap.data());
  d._rawCreatedAt = snap.data().createdAt;
  return d;
}

function openDetail(id) {
  const d = S.docs.find(x => x.id === id); if (!d) return;
  const idx = APP.steps.indexOf(d.step), m = S.me;
  const stepper = `<div class="stepper${isDone(d) ? ' done' : ''}">` + APP.steps.map((s, i) => `<div class="s${i <= idx ? ' on' : ''}"><i></i>${esc(s)}</div>`).join('') + '</div>';
  openModal(
    `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><span class="badge p-${esc(d.priority)}">${esc(d.priority)}</span><span style="font-size:13px;color:var(--muted)">${esc(d.id)}</span></div>` +
    `<h3>${esc(d.title)}</h3>` + stepper +
    `<dl class="kv"><dt>เลขที่หนังสือ</dt><dd>${esc(d.docNo || '-')}</dd>` +
    `<dt>ขั้นตอนปัจจุบัน</dt><dd><span class="stepchip ${stepClass(d.step)}">${esc(d.step)}</span></dd>` +
    `<dt>ตอนนี้อยู่ที่</dt><dd><b>${esc(d.holder || '-')}</b></dd>` +
    `<dt>ดำเนินการล่าสุด</dt><dd>${esc(d.lastNote || '-')}</dd>` +
    `<dt>ลงทะเบียน</dt><dd>${fmt(d.createdAt)} โดย ${esc(d.createdBy)}</dd>` +
    `<dt>อัปเดตล่าสุด</dt><dd>${fmt(d.updatedAt)} โดย ${esc(d.updatedBy)}</dd></dl>` +
    (m.canEdit ?
      '<form class="box" id="fUpd"><div style="font-weight:600;margin-bottom:10px">อัปเดตสถานะ / ส่งต่อ</div>' +
      `<div class="grid2"><div class="field"><label class="f">ขั้นตอน</label><select class="in" name="step">${opts(APP.steps, d.step)}</select></div>` +
      `<div class="field"><label class="f">ส่งต่อให้ / อยู่ที่ใคร</label><input class="in" name="holder" list="dlPeople" value="${esc(d.holder)}" maxlength="100"></div></div>` +
      '<div class="field"><label class="f">ดำเนินการอย่างไร</label><textarea class="in" name="note" maxlength="1000" placeholder="เช่น ตรวจแล้ว ส่งต่อให้ผู้อำนวยการลงนาม"></textarea></div>' +
      peopleList() + '<div class="err"></div><div style="text-align:right"><button type="submit" class="btn primary">บันทึกสถานะ</button></div></form>' : '') +
    '<div style="font-weight:600;margin-top:18px">ประวัติการดำเนินการ</div><ul class="timeline" id="hist"><li class="t">กำลังโหลด…</li></ul>' +
    '<div class="acts">' +
    (m.canDelete ? '<button class="btn danger" id="bDel" style="margin-right:auto">ลบเอกสาร</button>' : '') +
    (m.canEdit ? '<button class="btn" id="bEdit">แก้ไขข้อมูล</button>' : '') +
    '<button class="btn" data-close>ปิด</button></div>'
  );
  if (m.canEdit) {
    const f = $('fUpd');
    onSubmit(f, async () => {
      const cur = await freshDoc(id);
      const data = docData(cur);
      data.step = val(f, 'step'); data.holder = val(f, 'holder'); data.lastNote = val(f, 'note');
      const b = writeBatch(db);
      b.set(doc(db, 'docs', id), data);
      b.set(histRef(), hist(id, 'อัปเดตสถานะ', data.step, data.holder, data.lastNote));
      await b.commit();
      closeModal(); toast('บันทึกสถานะแล้ว');
    });
    $('bEdit').onclick = () => openEdit(d);
  }
  if (m.canDelete) $('bDel').onclick = () => openDelete(d);
  getDocs(query(collection(db, 'history'), where('docId', '==', id))).then(qs => {
    const el = $('hist'); if (!el) return;
    const h = qs.docs.map(x => x.data()).sort((a, b) => ms(b.time) - ms(a.time));
    el.innerHTML = h.length ? h.map(x =>
      `<li><div class="t">${fmt(x.time)} · ${esc(x.by)}</div><div><b>${esc(x.action)}</b> — ${esc(x.step)}${x.holder ? ' · อยู่ที่ ' + esc(x.holder) : ''}</div>${x.note ? `<div style="color:var(--muted)">${esc(x.note)}</div>` : ''}</li>`
    ).join('') : '<li class="t">ยังไม่มีประวัติ</li>';
  }).catch(e => { const el = $('hist'); if (el) el.innerHTML = `<li class="t">${esc(errText(e))}</li>`; });
}

function openEdit(d) {
  openModal(`<h3>แก้ไขข้อมูลเอกสาร</h3><div style="font-size:13px;color:var(--muted);margin-bottom:12px">${esc(d.id)}</div><form id="fEdit">` +
    `<div class="grid2"><div class="field"><label class="f">เลขที่หนังสือ</label><input class="in" name="docNo" value="${esc(d.docNo)}" maxlength="100"></div>` +
    `<div class="field"><label class="f">ความสำคัญ</label><select class="in" name="priority">${opts(APP.priorities, d.priority)}</select></div></div>` +
    `<div class="field"><label class="f">ชื่อเรื่อง *</label><input class="in" name="title" value="${esc(d.title)}" required maxlength="300"></div>` +
    '<div class="err"></div><div class="acts"><button type="button" class="btn" id="bBack">ย้อนกลับ</button><button type="submit" class="btn primary">บันทึก</button></div></form>');
  $('bBack').onclick = () => openDetail(d.id);
  const f = $('fEdit');
  onSubmit(f, async () => {
    const title = val(f, 'title');
    if (!title) throw new Error('กรุณากรอกชื่อเรื่อง');
    const cur = await freshDoc(d.id);
    const docNo = val(f, 'docNo'), priority = val(f, 'priority');
    const changes = [];
    if ((cur.docNo || '') !== docNo) changes.push(`เลขที่: ${cur.docNo || '-'} → ${docNo || '-'}`);
    if (cur.title !== title) changes.push(`เรื่อง: ${cur.title} → ${title}`);
    if (cur.priority !== priority) changes.push(`ความสำคัญ: ${cur.priority} → ${priority}`);
    if (changes.length) {
      const data = docData(cur);
      data.docNo = docNo; data.title = title; data.priority = priority;
      const b = writeBatch(db);
      b.set(doc(db, 'docs', d.id), data);
      b.set(histRef(), hist(d.id, 'แก้ไขข้อมูล', cur.step, cur.holder || '', changes.join(' | ')));
      await b.commit();
    }
    closeModal(); toast('แก้ไขข้อมูลแล้ว');
  });
}

function openDelete(d) {
  openModal(`<h3>ลบเอกสารนี้?</h3><p class="muted">${esc(d.id)} — ${esc(d.title)}<br>เอกสารจะหายจากรายการ ส่วนประวัติยังเก็บไว้</p>` +
    '<form id="fDel"><div class="err"></div><div class="acts"><button type="button" class="btn" id="bBack">ยกเลิก</button><button type="submit" class="btn danger">ยืนยันลบ</button></div></form>');
  $('bBack').onclick = () => openDetail(d.id);
  onSubmit($('fDel'), async () => {
    const b = writeBatch(db);
    b.delete(doc(db, 'docs', d.id));
    b.set(histRef(), hist(d.id, 'ลบเอกสาร', d.step, d.holder || '', 'เรื่อง: ' + d.title));
    await b.commit();
    closeModal(); toast('ลบเอกสารแล้ว');
  });
}

/* ---------- ผู้ใช้ ---------- */
function renderUsers() {
  const list = [...S.members].sort((a, b) => a.id.localeCompare(b.id));
  $('userRows').innerHTML = list.length ? list.map((x, i) =>
    `<tr class="click" data-i="${i}"><td>${esc(x.id)}</td><td>${esc(x.displayName)}</td><td>${esc(roleText(x))}</td><td>${x.active ? '<span class="stepchip done">ใช้งาน</span>' : '<span class="stepchip todo">ปิดใช้งาน</span>'}</td></tr>`
  ).join('') : '<tr><td colspan="4" class="muted">ยังไม่มีผู้ใช้ กด "+ เพิ่มผู้ใช้"</td></tr>';
  $('userRows').querySelectorAll('tr.click').forEach(tr => { tr.onclick = () => openUser(list[+tr.dataset.i]); });
}
function openUser(u) {
  const isNew = !u;
  u = u || { id: '', displayName: '', canAdd: false, canEdit: false, canDelete: false, isAdmin: false, active: true };
  const cb = (n, label) => `<label><input type="checkbox" name="${n}"${u[n] ? ' checked' : ''}> ${label}</label>`;
  openModal(`<h3>${isNew ? 'เพิ่มผู้ใช้' : 'แก้ไขผู้ใช้'}</h3><form id="fUser" style="margin-top:12px">` +
    `<div class="field"><label class="f">อีเมล Google (Gmail) ของผู้ใช้</label><input class="in" type="email" name="email" value="${esc(u.id)}" ${isNew ? 'required' : 'readonly'}></div>` +
    `<div class="field"><label class="f">ชื่อที่แสดง</label><input class="in" name="displayName" value="${esc(u.displayName)}" required maxlength="100"></div>` +
    '<label class="f" style="margin-top:6px">สิทธิ์ (ไม่เลือกเลย = ดูอย่างเดียว)</label>' +
    '<div class="perm">' + cb('canAdd', 'เพิ่ม/ลงทะเบียน') + cb('canEdit', 'แก้ไข/อัปเดตสถานะ') + cb('canDelete', 'ลบ') + cb('isAdmin', 'ผู้ดูแลระบบ (ทำได้ทุกอย่าง)') + '</div>' +
    '<div class="perm">' + cb('active', 'เปิดใช้งานบัญชี') + '</div>' +
    '<div class="err"></div><div class="acts"><button type="button" class="btn" data-close>ยกเลิก</button><button type="submit" class="btn primary">บันทึก</button></div></form>');
  const f = $('fUser');
  onSubmit(f, async () => {
    const email = val(f, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('อีเมลไม่ถูกต้อง');
    if (isNew && S.members.some(x => x.id === email)) throw new Error('มีผู้ใช้นี้อยู่แล้ว');
    const chk = n => f.elements[n].checked;
    await setDoc(doc(db, 'members', email), {
      email, displayName: val(f, 'displayName') || email,
      canAdd: chk('canAdd'), canEdit: chk('canEdit'), canDelete: chk('canDelete'), isAdmin: chk('isAdmin'), active: chk('active'),
      updatedAt: serverTimestamp()
    });
    closeModal(); toast('บันทึกผู้ใช้แล้ว');
  });
}
