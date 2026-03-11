const APP_VERSION = '1.17';

// ===== STATO APPLICAZIONE =====
const DAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const DAYS_FULL = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

let state = {
  workers: [],       // [{id, name}]
  departments: [],   // [{id, name, color}]
  weeks: {},         // {"2025-W01": { shifts: {"workerId_dayIndex": [{deptIds:[], customText, timeStart, timeEnd}]} }}
  currentWeek: null  // "YYYY-Www"
};

let editingShift = null; // {workerId, dayIndex, shiftIndex|null}

// ===== PERSISTENZA =====
function save() {
  localStorage.setItem('turni_state', JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem('turni_state');
  if (raw) {
    try {
      const saved = JSON.parse(raw);
      state = { ...state, ...saved };
    } catch (e) {
      console.error('Errore caricamento dati', e);
    }
  }
  if (!state.currentWeek) {
    state.currentWeek = getWeekKey(new Date());
  }
}

// ===== UTILITÀ SETTIMANA =====
function getWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const year = d.getFullYear();
  const week = Math.ceil(((d - new Date(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function getWeekDates(weekKey) {
  const [year, week] = weekKey.split('-W').map(Number);
  const jan4 = new Date(year, 0, 4);
  const startDay = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - startDay + 1 + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function formatDate(date) {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isToday(date) {
  const t = new Date();
  return date.getDate() === t.getDate() &&
    date.getMonth() === t.getMonth() &&
    date.getFullYear() === t.getFullYear();
}

function prevWeek() {
  const dates = getWeekDates(state.currentWeek);
  const prev = new Date(dates[0]);
  prev.setDate(prev.getDate() - 7);
  state.currentWeek = getWeekKey(prev);
  save();
  renderCalendar();
}

function nextWeek() {
  const dates = getWeekDates(state.currentWeek);
  const next = new Date(dates[0]);
  next.setDate(next.getDate() + 7);
  state.currentWeek = getWeekKey(next);
  save();
  renderCalendar();
}

function goToCurrentWeek() {
  state.currentWeek = getWeekKey(new Date());
  save();
  renderCalendar();
}

// ===== GESTIONE TURNI =====
function getWeekData() {
  if (!state.weeks[state.currentWeek]) {
    state.weeks[state.currentWeek] = { shifts: {} };
  }
  return state.weeks[state.currentWeek];
}

function getShiftKey(workerId, dayIndex) {
  return `${workerId}_${dayIndex}`;
}

// Migrazione da vecchio formato {deptId} a {deptIds:[]}
function migrateShift(s) {
  if (!s.deptIds) {
    s.deptIds = s.deptId ? [s.deptId] : [];
    delete s.deptId;
  }
  return s;
}

function getShifts(workerId, dayIndex) {
  const week = getWeekData();
  return (week.shifts[getShiftKey(workerId, dayIndex)] || []).map(migrateShift);
}

function setShifts(workerId, dayIndex, shifts) {
  const week = getWeekData();
  week.shifts[getShiftKey(workerId, dayIndex)] = shifts;
  save();
}

// ===== CALCOLO ORE =====
function parseMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function calcDuration(start, end) {
  const s = parseMinutes(start);
  const e = parseMinutes(end);
  if (s === null || e === null) return 0;
  let diff = e - s;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

function formatHours(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function calcWorkerWeekHours(workerId) {
  let total = 0;
  const byDay = [];
  for (let d = 0; d < 7; d++) {
    let dayMins = 0;
    getShifts(workerId, d).forEach(s => {
      dayMins += calcDuration(s.timeStart, s.timeEnd);
    });
    byDay.push(dayMins);
    total += dayMins;
  }
  return { total, byDay };
}

// ===== COPERTURA REPARTI =====
function checkDayCoverage(dayIndex) {
  if (state.departments.length === 0) return { ok: true, missing: [] };
  const covered = new Set();
  state.workers.forEach(w => {
    getShifts(w.id, dayIndex).forEach(s => {
      (s.deptIds || []).forEach(id => covered.add(id));
    });
  });
  const missing = state.departments.filter(d => !covered.has(d.id));
  return { ok: missing.length === 0, missing };
}

// ===== RENDERING CALENDARIO =====
function renderCalendar() {
  const dates = getWeekDates(state.currentWeek);
  const container = document.getElementById('view-calendar');

  // Week label
  const [y, w] = state.currentWeek.split('-W');
  document.getElementById('week-label').textContent =
    `Settimana ${w}/${y}  •  ${formatDate(dates[0])} – ${formatDate(dates[6])}`;

  // Nascondi banner (rimosso, la copertura è ora nel tfoot)
  document.getElementById('coverage-alert').classList.remove('visible');

  // Tabella
  const wrapper = document.getElementById('calendar-table-wrapper');

  if (state.workers.length === 0) {
    wrapper.innerHTML = `<div class="empty-state"><div class="icon">👷</div><p>Nessun lavoratore configurato.<br>Vai in <strong>Impostazioni</strong> per aggiungerne.</p></div>`;
    return;
  }

  let html = `<div class="calendar-wrapper"><table class="calendar-table"><thead><tr>`;
  html += `<th class="col-worker">Lavoratore</th>`;
  for (let d = 0; d < 7; d++) {
    const todayCls = isToday(dates[d]) ? ' today-col' : '';
    html += `<th class="${todayCls}">
      <div class="day-header-wrapper">
        <span>${DAYS[d]}</span>
        <span style="font-size:10px;opacity:0.7">${formatDate(dates[d])}</span>
      </div>
    </th>`;
  }
  html += `<th class="print-hide">Ore sett.</th></tr></thead><tbody>`;

  state.workers.forEach(worker => {
    const { total, byDay } = calcWorkerWeekHours(worker.id);
    const hoursCls = total > 40 * 60 ? 'over' : total > 0 ? 'ok' : '';
    html += `<tr>`;
    html += `<td class="worker-name-cell">${escapeHtml(worker.name)}</td>`;
    for (let d = 0; d < 7; d++) {
      const todayCls = isToday(dates[d]) ? ' today-col' : '';
      const shifts = getShifts(worker.id, d);
      html += `<td class="${todayCls}"><div class="shift-cell" data-worker="${worker.id}" data-day="${d}">`;
      shifts.forEach((s, i) => {
        const depts = (s.deptIds || []).map(id => state.departments.find(d => d.id === id)).filter(Boolean);
        const firstColor = depts.length > 0 ? depts[0].color : '#64748b';
        const lines = [...depts.map(d => escapeHtml(d.name))];
        if (s.customText) lines.push(`<em>${escapeHtml(s.customText)}</em>`);
        if (lines.length === 0) lines.push('—');
        const time = (s.timeStart && s.timeEnd) ? `${s.timeStart}–${s.timeEnd}` : (s.timeStart || '');
        html += `<span class="shift-badge" style="background:${firstColor}20;color:${firstColor};border:1px solid ${firstColor}50"
          data-worker="${worker.id}" data-day="${d}" data-idx="${i}">
          ${lines.map(l => `<span class="badge-dept-line">${l}</span>`).join('')}
          ${time ? `<span class="badge-time">${escapeHtml(time)}</span>` : ''}
        </span>`;
      });
      html += `<button class="shift-add-btn print-hide" data-worker="${worker.id}" data-day="${d}" title="Aggiungi turno">+</button>`;
      html += `</div></td>`;
    }
    html += `<td class="hours-cell ${hoursCls} print-hide" title="${DAYS_FULL.map((n,i) => n+': '+formatHours(byDay[i])).join('\n')}">${formatHours(total)}</td>`;
    html += `</tr>`;
  });

  // Tfoot: reparti non coperti per giorno
  const hasDepts = state.departments.length > 0;
  if (hasDepts) {
    const coverageByDay = Array.from({ length: 7 }, (_, d) => checkDayCoverage(d));
    const anyMissing = coverageByDay.some(c => !c.ok);
    if (anyMissing) {
      html += `<tfoot><tr><td class="coverage-foot-label">Scoperti</td>`;
      for (let d = 0; d < 7; d++) {
        const { ok, missing } = coverageByDay[d];
        const todayCls = isToday(dates[d]) ? ' today-col' : '';
        if (ok) {
          html += `<td class="coverage-foot-cell${todayCls}"></td>`;
        } else {
          const items = missing.map(m =>
            `<span class="coverage-missing-item" style="color:${m.color}">${escapeHtml(m.name)}</span>`
          ).join('');
          html += `<td class="coverage-foot-cell missing${todayCls}">${items}</td>`;
        }
      }
      html += `<td class="coverage-foot-cell print-hide"></td></tr></tfoot>`;
    }
  }

  html += `</tbody></table></div>`;
  wrapper.innerHTML = html;

  // Event delegation
  wrapper.querySelectorAll('.shift-add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openShiftModal(btn.dataset.worker, parseInt(btn.dataset.day), null);
    });
  });
  wrapper.querySelectorAll('.shift-badge').forEach(badge => {
    badge.addEventListener('click', e => {
      e.stopPropagation();
      openShiftModal(badge.dataset.worker, parseInt(badge.dataset.day), parseInt(badge.dataset.idx));
    });
  });
}

// ===== MODAL TURNO =====
function openShiftModal(workerId, dayIndex, shiftIndex) {
  editingShift = { workerId, dayIndex, shiftIndex };
  const worker = state.workers.find(w => w.id === workerId);
  const isEdit = shiftIndex !== null;
  const shift = isEdit ? getShifts(workerId, dayIndex)[shiftIndex] : null;
  const dates = getWeekDates(state.currentWeek);

  document.getElementById('modal-title').textContent =
    `${worker.name} – ${DAYS_FULL[dayIndex]} ${formatDate(dates[dayIndex])}`;

  // Chip reparti – multi-selezione con toggle
  const deptContainer = document.getElementById('modal-dept-chips');
  deptContainer.innerHTML = '';
  const selectedIds = new Set(shift?.deptIds || []);

  state.departments.forEach(dept => {
    const chip = document.createElement('span');
    chip.className = 'dept-chip';
    chip.style.background = dept.color + '30';
    chip.style.color = dept.color;
    chip.dataset.deptId = dept.id;
    chip.textContent = dept.name;
    if (selectedIds.has(dept.id)) chip.classList.add('selected');
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
    deptContainer.appendChild(chip);
  });

  document.getElementById('modal-custom-text').value = shift?.customText || '';
  createTimePicker('tp-start', 'modal-time-start', shift?.timeStart || '');
  createTimePicker('tp-end',   'modal-time-end',   shift?.timeEnd   || '',
    () => document.getElementById('modal-time-start').value);

  document.getElementById('modal-delete-btn').style.display = isEdit ? 'inline-flex' : 'none';
  document.getElementById('modal-overlay').classList.add('open');
}

function closeShiftModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingShift = null;
}

function copyFromPrevDay() {
  const { workerId, dayIndex } = editingShift;

  // Giorno precedente: se lunedì (0) → domenica (6) della settimana precedente
  let prevDayIndex, prevWeekKey;
  if (dayIndex === 0) {
    const dates = getWeekDates(state.currentWeek);
    const prevDate = new Date(dates[0]);
    prevDate.setDate(prevDate.getDate() - 1);
    prevWeekKey = getWeekKey(prevDate);
    prevDayIndex = 6;
  } else {
    prevWeekKey = state.currentWeek;
    prevDayIndex = dayIndex - 1;
  }

  const prevWeekData = state.weeks[prevWeekKey];
  const prevShifts = (prevWeekData?.shifts?.[getShiftKey(workerId, prevDayIndex)] || []).map(s => ({ ...s }));

  if (prevShifts.length === 0) {
    alert(`Nessun turno da copiare: ${DAYS_FULL[prevDayIndex === 6 && dayIndex === 0 ? 6 : dayIndex - 1]} non ha turni assegnati.`);
    return;
  }

  const currentShifts = getShifts(workerId, dayIndex);
  if (currentShifts.length > 0) {
    if (!confirm(`Sostituire i turni di ${DAYS_FULL[dayIndex]} con quelli di ${DAYS_FULL[prevDayIndex]}?`)) return;
  }

  setShifts(workerId, dayIndex, JSON.parse(JSON.stringify(prevShifts)));
  closeShiftModal();
  renderCalendar();
  renderHours();
}

function saveShift() {
  const { workerId, dayIndex, shiftIndex } = editingShift;

  const deptIds = [];
  document.querySelectorAll('#modal-dept-chips .dept-chip').forEach(c => {
    if (c.classList.contains('selected') && c.dataset.deptId) deptIds.push(c.dataset.deptId);
  });

  const customText = document.getElementById('modal-custom-text').value.trim();
  const timeStart = document.getElementById('modal-time-start').value;
  const timeEnd = document.getElementById('modal-time-end').value;

  if (deptIds.length === 0 && !customText) {
    alert('Seleziona almeno un reparto o inserisci un testo libero.');
    return;
  }

  const shiftData = { deptIds, customText, timeStart, timeEnd };

  const shifts = [...getShifts(workerId, dayIndex)];
  if (shiftIndex !== null) {
    shifts[shiftIndex] = shiftData;
  } else {
    shifts.push(shiftData);
  }
  setShifts(workerId, dayIndex, shifts);
  closeShiftModal();
  renderCalendar();
  renderHours();
}

function deleteShift() {
  const { workerId, dayIndex, shiftIndex } = editingShift;
  const shifts = [...getShifts(workerId, dayIndex)];
  shifts.splice(shiftIndex, 1);
  setShifts(workerId, dayIndex, shifts);
  closeShiftModal();
  renderCalendar();
  renderHours();
}

// ===== RENDERING IMPOSTAZIONI =====
function renderSettings() {
  renderWorkersList();
  renderDeptsList();
}

function renderWorkersList() {
  const container = document.getElementById('workers-list');
  if (state.workers.length === 0) {
    container.innerHTML = '<p style="color:var(--text2);font-size:13px">Nessun lavoratore</p>';
    return;
  }
  container.innerHTML = state.workers.map(w => `
    <div class="list-item">
      <span class="item-name">${escapeHtml(w.name)}</span>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="editWorker('${w.id}')" title="Modifica">✏</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="deleteWorker('${w.id}')" title="Elimina">✕</button>
    </div>
  `).join('');
}

function renderDeptsList() {
  const container = document.getElementById('depts-list');
  if (state.departments.length === 0) {
    container.innerHTML = '<p style="color:var(--text2);font-size:13px">Nessun reparto</p>';
    return;
  }
  container.innerHTML = state.departments.map(d => `
    <div class="list-item">
      <div class="item-color" style="background:${d.color}"></div>
      <span class="item-name">${escapeHtml(d.name)}</span>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="editDept('${d.id}')" title="Modifica">✏</button>
      <button class="btn btn-danger btn-sm btn-icon" onclick="deleteDept('${d.id}')" title="Elimina">✕</button>
    </div>
  `).join('');
}

// ===== CRUD LAVORATORI =====
function addWorker() {
  const input = document.getElementById('new-worker-name');
  const name = input.value.trim();
  if (!name) return;
  state.workers.push({ id: uid(), name });
  input.value = '';
  save();
  renderWorkersList();
  renderCalendar();
}

function editWorker(id) {
  const worker = state.workers.find(w => w.id === id);
  const name = prompt('Modifica nome lavoratore:', worker.name);
  if (name && name.trim()) {
    worker.name = name.trim();
    save();
    renderWorkersList();
    renderCalendar();
    renderHours();
  }
}

function deleteWorker(id) {
  if (!confirm('Eliminare il lavoratore? Tutti i suoi turni verranno rimossi.')) return;
  state.workers = state.workers.filter(w => w.id !== id);
  // Pulizia turni
  Object.values(state.weeks).forEach(week => {
    Object.keys(week.shifts).forEach(key => {
      if (key.startsWith(id + '_')) delete week.shifts[key];
    });
  });
  save();
  renderSettings();
  renderCalendar();
  renderHours();
}

// ===== CRUD REPARTI =====
function addDept() {
  const nameInput = document.getElementById('new-dept-name');
  const colorInput = document.getElementById('new-dept-color');
  const name = nameInput.value.trim();
  if (!name) return;
  state.departments.push({ id: uid(), name, color: colorInput.value });
  nameInput.value = '';
  colorInput.value = randomColor();
  save();
  renderDeptsList();
  renderCalendar();
}

function editDept(id) {
  const dept = state.departments.find(d => d.id === id);
  const name = prompt('Modifica nome reparto:', dept.name);
  if (name && name.trim()) {
    dept.name = name.trim();
    save();
    renderDeptsList();
    renderCalendar();
    renderHours();
  }
}

function deleteDept(id) {
  if (!confirm('Eliminare il reparto? I turni assegnati a questo reparto resteranno come testo.')) return;
  const dept = state.departments.find(d => d.id === id);
  // Rimuovi il reparto dai turni; se era l'unico, converte in testo libero
  Object.values(state.weeks).forEach(week => {
    Object.keys(week.shifts).forEach(key => {
      week.shifts[key] = week.shifts[key].map(s => {
        migrateShift(s);
        if (!(s.deptIds || []).includes(id)) return s;
        const newDeptIds = s.deptIds.filter(did => did !== id);
        // Se non rimangono reparti né testo, aggiungi il nome come testo libero
        const newCustomText = (newDeptIds.length === 0 && !s.customText)
          ? dept.name
          : s.customText;
        return { ...s, deptIds: newDeptIds, customText: newCustomText };
      });
    });
  });
  state.departments = state.departments.filter(d => d.id !== id);
  save();
  renderSettings();
  renderCalendar();
}

// ===== RENDERING ORE =====
function renderHours() {
  const dates = getWeekDates(state.currentWeek);
  const [y, w] = state.currentWeek.split('-W');
  const lbl = document.getElementById('week-label-h');
  if (lbl) lbl.textContent = `Settimana ${w}/${y}  •  ${formatDate(dates[0])} – ${formatDate(dates[6])}`;

  const container = document.getElementById('hours-grid');
  if (state.workers.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>Nessun lavoratore configurato.</p></div>`;
    return;
  }
  container.innerHTML = state.workers.map(worker => {
    const { total, byDay } = calcWorkerWeekHours(worker.id);
    const daysHtml = DAYS.map((d, i) => byDay[i] > 0
      ? `<div class="hours-day-row"><span>${d}</span><span>${formatHours(byDay[i])}</span></div>`
      : '').join('');
    const cls = total > 40 * 60 ? 'color:var(--warn)' : total > 0 ? 'color:var(--success)' : '';
    return `<div class="hours-card">
      <div class="worker-name">${escapeHtml(worker.name)}</div>
      <div class="total-hours" style="${cls}">${formatHours(total)}</div>
      <div class="hours-label">totale settimana</div>
      <div style="margin-top:8px">${daysHtml || '<span style="font-size:12px;color:var(--text2)">Nessun turno</span>'}</div>
    </div>`;
  }).join('');
}

// ===== TAB NAVIGATION =====
function showTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(`view-${tabId}`).classList.add('active');
  if (tabId === 'calendar') renderCalendar();
  if (tabId === 'settings') renderSettings();
  if (tabId === 'hours') renderHours();
}

// ===== COPIA SETTIMANA PRECEDENTE =====
function copyFromPrevWeek() {
  const dates = getWeekDates(state.currentWeek);
  const prevDate = new Date(dates[0]);
  prevDate.setDate(prevDate.getDate() - 7);
  const prevWeekKey = getWeekKey(prevDate);

  const prevData = state.weeks[prevWeekKey];
  const prevShifts = prevData?.shifts || {};
  const hasAny = Object.keys(prevShifts).length > 0;

  if (!hasAny) {
    alert('La settimana precedente non contiene turni da copiare.');
    return;
  }

  const [py, pw] = prevWeekKey.split('-W');
  const prevDates = getWeekDates(prevWeekKey);
  const currentData = getWeekData();
  const hasCurrentShifts = Object.values(currentData.shifts).some(s => s.length > 0);

  const msg = hasCurrentShifts
    ? `Copiare i turni dalla settimana ${pw}/${py} (${formatDate(prevDates[0])}–${formatDate(prevDates[6])})?\n\nATTENZIONE: tutti i turni della settimana corrente verranno sovrascritti.`
    : `Copiare i turni dalla settimana ${pw}/${py} (${formatDate(prevDates[0])}–${formatDate(prevDates[6])})?`;

  if (!confirm(msg)) return;

  currentData.shifts = JSON.parse(JSON.stringify(prevShifts));
  save();
  renderCalendar();
  renderHours();
}

// ===== STAMPA =====
function printCalendar() {
  showTab('calendar');

  const dates = getWeekDates(state.currentWeek);
  const [y, w] = state.currentWeek.split('-W');
  const weekLabel = `Settimana ${w}/${y}  •  ${formatDate(dates[0])} – ${formatDate(dates[6])}`;

  function buildThead() {
    let h = `<thead><tr><th class="col-worker">Lavoratore</th>`;
    for (let d = 0; d < 7; d++) {
      h += `<th><div class="day-header-wrapper">
        <span>${DAYS[d]}</span>
        <span style="font-size:10px;opacity:0.7">${formatDate(dates[d])}</span>
      </div></th>`;
    }
    return h + `</tr></thead>`;
  }

  const wrapper = document.getElementById('print-tables');
  wrapper.innerHTML = '';

  for (let i = 0; i < state.workers.length; i += 4) {
    const group = state.workers.slice(i, i + 4);

    let html = '';

    html += `<table class="calendar-table print-table">${buildThead()}<tbody>`;
    group.forEach(worker => {
      html += `<tr><td class="worker-name-cell">${escapeHtml(worker.name)}</td>`;
      for (let d = 0; d < 7; d++) {
        const shifts = getShifts(worker.id, d);
        html += `<td><div class="shift-cell">`;
        shifts.forEach(s => {
          const depts = (s.deptIds || []).map(id => state.departments.find(dep => dep.id === id)).filter(Boolean);
          const lines = [...depts.map(dep => escapeHtml(dep.name))];
          if (s.customText) lines.push(`<em>${escapeHtml(s.customText)}</em>`);
          if (lines.length === 0) lines.push('—');
          const time = (s.timeStart && s.timeEnd) ? `${s.timeStart}–${s.timeEnd}` : (s.timeStart || '');
          html += `<span class="shift-badge">
            ${lines.map(l => `<span class="badge-dept-line">${l}</span>`).join('')}
            ${time ? `<span class="badge-time">${escapeHtml(time)}</span>` : ''}
          </span>`;
        });
        html += `</div></td>`;
      }
      html += `</tr>`;
    });
    html += `</tbody></table>`;

    const page = document.createElement('div');
    page.className = 'print-page';
    page.innerHTML = html;
    wrapper.appendChild(page);
  }

  setTimeout(() => window.print(), 150);
}

// ===== TIME PICKER =====
function createTimePicker(containerId, hiddenId, initialValue, getDefault) {
  const container = document.getElementById(containerId);
  const hidden = document.getElementById(hiddenId);

  let active = !!initialValue;
  let hour = 8, minute = 0;

  function parseTime(val) {
    if (!val) return null;
    const [h, m] = val.split(':').map(Number);
    return { h, m: Math.round(m / 15) * 15 % 60 };
  }

  if (initialValue) {
    const t = parseTime(initialValue);
    hour = t.h; minute = t.m;
  }

  function sync() {
    hidden.value = active
      ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      : '';
  }

  function render() {
    if (!active) {
      container.innerHTML =
        `<button class="tp-activate">+ Imposta orario</button>`;
      container.querySelector('.tp-activate').addEventListener('click', () => {
        if (getDefault) {
          const t = parseTime(getDefault());
          if (t) { hour = t.h; minute = t.m; }
        }
        active = true;
        sync();
        render();
      });
      sync();
      return;
    }

    container.innerHTML = `
      <div class="tp-row">
        <button class="tp-arr" data-d="-1">−</button>
        <span class="tp-h">${String(hour).padStart(2, '0')}</span>
        <button class="tp-arr" data-d="1">+</button>
        <span class="tp-col">:</span>
        <div class="tp-mins">
          ${[0, 15, 30, 45].map(m =>
            `<button class="tp-m${m === minute ? ' sel' : ''}" data-m="${m}">${String(m).padStart(2, '0')}</button>`
          ).join('')}
        </div>
        <button class="tp-clear" title="Rimuovi orario">×</button>
      </div>`;

    container.querySelectorAll('.tp-arr').forEach(b =>
      b.addEventListener('click', () => {
        hour = (hour + parseInt(b.dataset.d) + 24) % 24;
        sync(); render();
      })
    );
    container.querySelectorAll('.tp-m').forEach(b =>
      b.addEventListener('click', () => {
        minute = parseInt(b.dataset.m);
        sync(); render();
      })
    );
    container.querySelector('.tp-clear').addEventListener('click', () => {
      active = false;
      sync(); render();
    });

    sync();
  }

  render();
}

// ===== UTILITÀ =====
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function randomColor() {
  const colors = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#84cc16'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  load();

  // Registra Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Week navigation
  document.getElementById('btn-prev-week').addEventListener('click', prevWeek);
  document.getElementById('btn-next-week').addEventListener('click', nextWeek);
  document.getElementById('btn-today').addEventListener('click', goToCurrentWeek);

  // Aggiungi lavoratore
  document.getElementById('btn-add-worker').addEventListener('click', addWorker);
  document.getElementById('new-worker-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addWorker();
  });

  // Aggiungi reparto
  document.getElementById('btn-add-dept').addEventListener('click', addDept);
  document.getElementById('new-dept-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') addDept();
  });
  document.getElementById('new-dept-color').value = randomColor();

  // Modal
  document.getElementById('modal-save-btn').addEventListener('click', saveShift);
  document.getElementById('modal-delete-btn').addEventListener('click', deleteShift);
  document.getElementById('modal-cancel-btn').addEventListener('click', closeShiftModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeShiftModal();
  });

  // Copia giorno precedente (nella modal)
  document.getElementById('modal-copy-prev-day').addEventListener('click', copyFromPrevDay);

  // Copia settimana precedente
  document.getElementById('btn-copy-prev-week').addEventListener('click', copyFromPrevWeek);

  // Stampa
  document.getElementById('btn-print').addEventListener('click', printCalendar);

  // Versione nell'header
  document.querySelector('header h1').textContent = `📅 Turni v${APP_VERSION}`;

  // Avvio sulla tab calendario
  showTab('calendar');
});
