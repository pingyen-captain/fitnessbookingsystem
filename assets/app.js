// 簡易預約管理前端（無後端）：localStorage 作為儲存層
const DB_KEY = 'bookingapp_data';

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { console.warn('DB parse error', e); }
  }
  // 初始資料：示範服務與下週預設可約時段
  const today = new Date();
  const initAvailability = {};
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = fmtDate(d);
    initAvailability[key] = ['10:00', '11:00', '14:00', '16:00'];
  }
  return {
    services: [
      { id: id(), name: '一對一私人教練 60min', price: 1500 },
      { id: id(), name: '體能評估 90min', price: 2000 },
      { id: id(), name: '小班團課 60min', price: 600 },
    ],
    availability: initAvailability,
    bookings: [],
    settings: { location: '', notes: '', lineUrl: '', liffId: '', googleClientId: '', googleCalendarId: 'primary', adminPhones: ['0984155277'] },
    auth: { loggedIn: false, account: '', phone: '' },
    users: [ { account: 'admin', password: '123456' } ],
    otp: {}
  };
}

function setCloudStatus(msg) {
  try {
    const el = document.getElementById('cloud-result');
    if (el) el.textContent = msg || '';
  } catch (e) { /* ignore */ }
}
let firebaseApp = null, firestore = null, cloudDocRef = null, unsubscribeCloud = null, lastAppliedCloudTs = 0, pushingCloud = false;
function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  if (DB && DB.settings && DB.settings.syncEnabled && cloudDocRef && firestore) {
    try {
      pushingCloud = true;
      const ts = Date.now();
      lastAppliedCloudTs = ts;
      cloudDocRef.set({ data: db, updatedAt: ts }, { merge: true })
        .then(() => setCloudStatus('已推送到雲端'))
        .catch(err => setCloudStatus('雲端推送失敗：' + (err && err.message)))
        .finally(() => { pushingCloud = false; });
    } catch (e) {
      pushingCloud = false;
      setCloudStatus('雲端推送失敗：' + (e && e.message));
    }
  }
}
function id() { return Math.random().toString(36).slice(2, 10); }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function parseDateStr(str) { const [y,m,da] = str.split('-').map(Number); return new Date(y, m-1, da); }

let DB = loadDB();
if (DB && DB.settings && !DB.settings.googleClientId) {
  DB.settings.googleClientId = '1002607031193-5o6cl3iu7gaj3o3klvbvb7pk07qoghdt.apps.googleusercontent.com';
  if (!DB.settings.googleCalendarId) DB.settings.googleCalendarId = 'primary';
  saveDB(DB);
}
// 新增：若缺少商家手機名單，初始化一個示例並保存
if (DB && DB.settings && !Array.isArray(DB.settings.adminPhones)) {
  DB.settings.adminPhones = ['0984155277'];
  saveDB(DB);
}
// 強制更新商家的電話為指定號碼（覆蓋舊設定）
if (DB && DB.settings) {
  const targetAdmin = '0984155277';
  if (!Array.isArray(DB.settings.adminPhones) || DB.settings.adminPhones.length !== 1 || DB.settings.adminPhones[0] !== targetAdmin) {
    DB.settings.adminPhones = [targetAdmin];
    saveDB(DB);
  }
}
// 雲端同步初始化（根據設定啟用 Firestore 並建立訂閱）
function initCloudSync() {
  try {
    if (!(DB && DB.settings && DB.settings.syncEnabled)) { setCloudStatus('未啟用同步'); return; }
    if (!(window.firebase && firebase.firestore)) { setCloudStatus('缺少 Firebase SDK'); return; }
    const apiKey = (DB.settings.firebaseApiKey || '').trim();
    const projectId = (DB.settings.firebaseProjectId || '').trim();
    const authDomain = (DB.settings.firebaseAuthDomain || `${projectId}.firebaseapp.com`).trim();
    if (!apiKey || !projectId) { setCloudStatus('請填寫 Firebase API Key 與 Project ID'); return; }
    if (!firebaseApp) {
      try { firebaseApp = firebase.initializeApp({ apiKey, projectId, authDomain }, 'bookingapp'); } catch (e) { /* ignore if already initialized */ }
      firestore = firebase.firestore();
    }
    const docId = (DB.settings.syncKey && DB.settings.syncKey.trim()) || (Array.isArray(DB.settings.adminPhones) && DB.settings.adminPhones[0]) || 'default';
    cloudDocRef = firestore.collection('bookingapp').doc(docId);
    if (unsubscribeCloud) { try { unsubscribeCloud(); } catch (_) {} }
    unsubscribeCloud = cloudDocRef.onSnapshot(snap => {
      const data = snap.data();
      if (!data || !data.data) return;
      const ts = data.updatedAt || 0;
      if (pushingCloud) return; // ignore our own push
      if (ts <= lastAppliedCloudTs) return;
      lastAppliedCloudTs = ts;
      DB = data.data;
      localStorage.setItem(DB_KEY, JSON.stringify(DB));
      try {
        renderCalendar();
        renderBookForm();
        renderAdmin();
        renderSettings();
        updateNavForAuth();
        updateHomeDashboard();
        renderMyBookings();
      } catch (_) {}
      setCloudStatus('已從雲端同步最新資料');
    });
    cloudDocRef.get().then(snap => {
      if (!snap.exists) {
        pushingCloud = true;
        const ts = Date.now();
        lastAppliedCloudTs = ts;
        cloudDocRef.set({ data: DB, updatedAt: ts }).then(() => setCloudStatus('已初始化雲端文件')).finally(() => { pushingCloud = false; });
      } else {
        setCloudStatus('雲端同步已連線');
      }
    });
  } catch (e) {
    setCloudStatus('雲端初始化失敗：' + (e && e.message));
  }
}
// 月份狀態（避免在 render 之前未初始化）
let current = new Date();
current.setDate(1);

// 路由控制
const views = {
  home: document.getElementById('view-home'),
  calendar: document.getElementById('view-calendar'),
  book: document.getElementById('view-book'),
  my: document.getElementById('view-my'),
  admin: document.getElementById('view-admin'),
  settings: document.getElementById('view-settings'),
  login: document.getElementById('view-login'),
  register: document.getElementById('view-register'),
};
const navLinks = {
  home: document.getElementById('nav-home'),
  calendar: document.getElementById('nav-calendar'),
  book: document.getElementById('nav-book'),
  my: document.getElementById('nav-my'),
  admin: document.getElementById('nav-admin'),
  settings: document.getElementById('nav-settings'),
  login: document.getElementById('nav-login'),
  register: document.getElementById('nav-register'),
  logout: document.getElementById('nav-logout'),
};
// 首頁登入/儀表板區塊
const homeLogin = document.getElementById('home-login');
const homeDashboard = document.getElementById('home-dashboard');
const dashMerchant = document.getElementById('home-dash-merchant');
const dashCustomer = document.getElementById('home-dash-customer');

function updateHomeDashboard() {
  const logged = !!(DB.auth && DB.auth.loggedIn);
  const role = (DB.auth && DB.auth.role) || '';
  if (homeLogin && homeDashboard) {
    // 客戶登入後不顯示首頁（登入表單與儀表板皆隱藏）
    if (logged && role === 'customer') {
      homeLogin.classList.add('hidden');
      homeDashboard.classList.add('hidden');
    } else {
      homeLogin.classList.toggle('hidden', logged);
      homeDashboard.classList.toggle('hidden', !logged);
    }
  }
  if (dashMerchant) dashMerchant.classList.toggle('hidden', role !== 'merchant');
  if (dashCustomer) dashCustomer.classList.toggle('hidden', role !== 'customer');
}

function updateNavForAuth() {
  const logged = !!(DB.auth && DB.auth.loggedIn);
  const role = (DB.auth && DB.auth.role) || '';
  const showForMerchant = ['admin','settings'];
  const showForCustomer = ['calendar','my'];
  ['calendar','book','my','admin','settings'].forEach(id => {
    const shouldShow = logged && ((role === 'merchant' && showForMerchant.includes(id)) || (role === 'customer' && showForCustomer.includes(id)));
    if (navLinks[id]) navLinks[id].classList.toggle('hidden', !shouldShow);
  });
  if (navLinks.login) navLinks.login.classList.toggle('hidden', logged);
  if (navLinks.register) navLinks.register.classList.toggle('hidden', logged);
  if (navLinks.logout) navLinks.logout.classList.toggle('hidden', !logged);
  // 客戶登入後隱藏首頁連結，只保留日曆、我的預約與登出
  if (navLinks.home) navLinks.home.classList.toggle('hidden', logged && role === 'customer');
  updateHomeDashboard();
}

function doLogout() {
  DB.auth = null;
  saveDB(DB);
  updateNavForAuth();
  updateHomeDashboard();
  location.hash = '#home';
}

function showView(name) {
  Object.values(views).forEach(v => { if (v) v.classList.add('hidden'); });
  Object.values(navLinks).forEach(a => { if (a) a.classList.remove('active'); });
  // 支援自定義登入/登出路由
  if (name && name.startsWith('login')) { name = 'home'; }
  if (name === 'logout') { doLogout(); name = 'home'; }
  const requiresAuth = ['my', 'admin', 'settings'];
  if (requiresAuth.includes(name) && !(DB.auth && DB.auth.loggedIn)) {
    name = 'home';
  }
  // 客戶登入後訪問首頁時，自動導向日曆
  if ((DB.auth && DB.auth.loggedIn && DB.auth.role === 'customer') && name === 'home') {
    name = 'calendar';
  }
  if (!views[name]) name = 'home';
  if (views[name]) views[name].classList.remove('hidden');
  if (navLinks[name]) navLinks[name].classList.add('active');
  updateNavForAuth();
  // 進入頁面時重新渲染
  if (name === 'home') { updateHomeDashboard(); }
  if (name === 'calendar') renderCalendar();
  if (name === 'book') renderBookForm();
  if (name === 'admin') renderAdmin();
  if (name === 'settings') renderSettings();
  if (name === 'my') renderMyBookings();
}

window.addEventListener('hashchange', () => {
  const route = location.hash.replace('#','') || 'home';
  showView(route);
});
showView((location.hash || '#home').replace('#',''));
updateNavForAuth();

// 綁定登出
if (navLinks.logout) {
  navLinks.logout.addEventListener('click', (e) => {
    e.preventDefault();
    doLogout();
  });
}

// 日曆
const prevMonth = document.getElementById('prev-month');
const nextMonth = document.getElementById('next-month');


prevMonth.addEventListener('click', () => { current.setMonth(current.getMonth()-1); renderCalendar(); });
nextMonth.addEventListener('click', () => { current.setMonth(current.getMonth()+1); renderCalendar(); });

function isBooked(dateStr, time) {
  return DB.bookings.some(b => b.date === dateStr && b.time === time);
}

function renderCalendar() {
  const monthLabel = document.getElementById('month-label');
  const calendarGrid = document.getElementById('calendar-grid');
  const dayDetail = document.getElementById('day-detail');
  const title = `${current.getFullYear()} 年 ${current.getMonth()+1} 月`;
  monthLabel.textContent = title;
  calendarGrid.innerHTML = '';
  dayDetail.classList.add('hidden');
  const startDay = new Date(current);
  const startWeekday = startDay.getDay();
  const daysInMonth = new Date(current.getFullYear(), current.getMonth()+1, 0).getDate();
  // 補空白
  for (let i=0;i<startWeekday;i++) {
    const filler = document.createElement('div');
    calendarGrid.appendChild(filler);
  }
  for (let d=1; d<=daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    const dateStr = `${current.getFullYear()}-${pad(current.getMonth()+1)}-${pad(d)}`;
    const availableList = (DB.availability[dateStr] || []);
    const remaining = availableList.filter(t => !isBooked(dateStr, t));
    if (remaining.length > 0) cell.classList.add('available');
    const top = document.createElement('div');
    top.className = 'date';
    top.textContent = String(d);
    const bottom = document.createElement('div');
    bottom.className = 'slots';
    bottom.textContent = remaining.length > 0 ? `可預約：${remaining.length} 檔` : '無可預約';
    cell.appendChild(top);
    cell.appendChild(bottom);
    cell.addEventListener('click', () => showDayDetail(dateStr));
    calendarGrid.appendChild(cell);
  }
}

function showDayDetail(dateStr) {
  const dayDetail = document.getElementById('day-detail');
  const date = parseDateStr(dateStr);
  const slots = (DB.availability[dateStr] || []).filter(t => !isBooked(dateStr, t));
  dayDetail.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <div>
        <h3>${dateStr}（${['日','一','二','三','四','五','六'][date.getDay()]}）</h3>
        <div class="meta">地點：${DB.settings.location || '未設定'}</div>
        <div class="meta">注意事項：${DB.settings.notes || '—'}</div>
      </div>
      <div>
        <button class="primary" id="goto-book">前往預約</button>
      </div>
    </div>
    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
      ${slots.length ? slots.map(s => `<span class="pill">${s}</span>`).join('') : '<span class="pill muted">此日無可預約時段</span>'}
    </div>
  `;
  dayDetail.classList.remove('hidden');
  document.getElementById('goto-book')?.addEventListener('click', () => {
    location.hash = '#book';
    setTimeout(() => {
      document.getElementById('book-date').value = dateStr;
      fillTimesForDate(dateStr);
    }, 0);
  });
}

// 預約流程
const bookForm = document.getElementById('book-form');
const bookDate = document.getElementById('book-date');
const bookTime = document.getElementById('book-time');
const bookService = document.getElementById('book-service');
const bookName = document.getElementById('book-name');
const bookPhone = document.getElementById('book-phone');
const bookEmail = document.getElementById('book-email');
const bookNotes = document.getElementById('book-notes');
const bookResult = document.getElementById('book-result');

bookDate.addEventListener('change', () => fillTimesForDate(bookDate.value));

function renderBookForm() {
  // 服務項目
  bookService.innerHTML = '';
  DB.services.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name}`;
    bookService.appendChild(opt);
  });
  // 預設今天後的第一個可預約日期
  const today = fmtDate(new Date());
  const upcoming = Object.keys(DB.availability).filter(d => d >= today).sort()[0];
  if (upcoming) {
    bookDate.value = upcoming;
    fillTimesForDate(upcoming);
  } else {
    bookDate.value = '';
    bookTime.innerHTML = '';
  }
}

function fillTimesForDate(dateStr) {
  bookTime.innerHTML = '';
  (DB.availability[dateStr] || []).filter(t => !isBooked(dateStr, t)).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t; opt.textContent = t; bookTime.appendChild(opt);
  });
}

bookForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const date = bookDate.value;
  const time = bookTime.value;
  const svcId = bookService.value;
  const svc = DB.services.find(s => s.id === svcId);
  if (!date || !time || !svc) { alert('請完整填寫預約資訊'); return; }
  if (isBooked(date, time)) { alert('此時段已被預約'); return; }
  const booking = {
    id: id(),
    date, time,
    customer: bookName.value.trim(),
    phone: bookPhone.value.trim(),
    email: (bookEmail?.value || '').trim(),
    serviceId: svc.id,
    serviceName: svc.name,
    price: Number(svc.price) || 0,
    location: DB.settings.location || '',
    notes: bookNotes.value.trim(),
    paid: false,
    createdAt: new Date().toISOString(),
  };
  DB.bookings.push(booking);
  saveDB(DB);
  maybeAddToGoogleCalendar(booking);
  renderCalendar();
  renderAdmin();
  bookResult.classList.remove('hidden');
  bookResult.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <div>
        <div class="pill success">已建立預約</div>
        <div class="meta" style="margin-top:6px;">${booking.date} ${booking.time} ・ ${booking.serviceName} ・ $${booking.price}</div>
      </div>
      <div>
        <button class="primary" id="go-pay">前往付款（示意）</button>
      </div>
    </div>
  `;
  document.getElementById('go-pay')?.addEventListener('click', () => {
    alert('此為付款流程占位，可整合第三方金流（如信用卡、Line Pay、綠界等）。目前將狀態標記為已付款。');
    booking.paid = true; saveDB(DB); renderAdmin();
  });
  bookForm.reset();
});

// 管理後台
const bookingTableBody = document.querySelector('#booking-table tbody');
const revenueSummary = document.getElementById('revenue-summary');
const reminderList = document.getElementById('reminder-list');

// 後台清單控制元件與狀態
const adminSearch = document.getElementById('admin-search');
const adminPaid = document.getElementById('admin-paid');
const adminDate = document.getElementById('admin-date');
const adminPageSize = document.getElementById('admin-page-size');
const adminPrev = document.getElementById('admin-prev');
const adminNext = document.getElementById('admin-next');
const adminPageInfo = document.getElementById('admin-page-info');

DB.adminView = DB.adminView || { search:'', paid:'all', date:'', pageSize:10, page:1 };

function bindAdminControls() {
  if (adminSearch) adminSearch.addEventListener('input', () => { DB.adminView.search = adminSearch.value.trim(); DB.adminView.page = 1; renderAdmin(); });
  if (adminPaid) adminPaid.addEventListener('change', () => { DB.adminView.paid = adminPaid.value; DB.adminView.page = 1; renderAdmin(); });
  if (adminDate) adminDate.addEventListener('change', () => { DB.adminView.date = adminDate.value || ''; DB.adminView.page = 1; renderAdmin(); });
  if (adminPageSize) adminPageSize.addEventListener('change', () => { DB.adminView.pageSize = Number(adminPageSize.value)||10; DB.adminView.page = 1; renderAdmin(); });
  if (adminPrev) adminPrev.addEventListener('click', () => { DB.adminView.page = Math.max(1, DB.adminView.page - 1); renderAdmin(); });
  if (adminNext) adminNext.addEventListener('click', () => { DB.adminView.page = DB.adminView.page + 1; renderAdmin(); });
}
bindAdminControls();

function renderAdmin() {
  // 表格
  bookingTableBody.innerHTML = '';
  const sorted = [...DB.bookings].sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time));
  const state = DB.adminView || { search:'', paid:'all', date:'', pageSize:10, page:1 };
  let list = sorted.filter(b => {
    const q = (state.search || '').toLowerCase();
    const matchesSearch = !q || [b.customer, b.phone, b.serviceName].some(x => (x||'').toLowerCase().includes(q));
    const matchesPaid = state.paid === 'all' || (state.paid === 'paid' ? !!b.paid : !b.paid);
    const matchesDate = !state.date || b.date === state.date;
    return matchesSearch && matchesPaid && matchesDate;
  });
  const total = list.length;
  const pageSize = Number(state.pageSize) || 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, state.page), totalPages);
  if (state.page !== page) { DB.adminView.page = page; }
  const start = (page - 1) * pageSize;
  const pageItems = list.slice(start, start + pageSize);
  for (const b of pageItems) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${b.date}</td>
      <td>${b.time}</td>
      <td>${b.customer}</td>
      <td>${b.serviceName}</td>
      <td>$${b.price}</td>
      <td>${b.location || '—'}</td>
      <td>${b.paid ? '<span class="pill success">已付款</span>' : '<span class="pill warn">未付款</span>'}</td>
      <td>
        <button class="ghost" data-act="toggle" data-id="${b.id}">${b.paid ? '標記未付' : '標記已付'}</button>
        <button class="danger" data-act="del" data-id="${b.id}">刪除</button>
      </td>
    `;
    bookingTableBody.appendChild(tr);
  }
  bookingTableBody.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      const idx = DB.bookings.findIndex(x => x.id === id);
      if (idx === -1) return;
      if (act === 'toggle') { DB.bookings[idx].paid = !DB.bookings[idx].paid; }
      if (act === 'del') { DB.bookings.splice(idx,1); }
      saveDB(DB); renderAdmin(); renderCalendar();
    });
  });

  // 更新分頁資訊與按鈕狀態
  if (adminPageInfo) adminPageInfo.textContent = `第 ${page} / ${totalPages} 頁，共 ${total} 筆`;
  if (adminPrev) adminPrev.disabled = page <= 1;
  if (adminNext) adminNext.disabled = page >= totalPages;

  // 收入報表
  const totalPaid = DB.bookings.filter(b => b.paid).reduce((sum, b) => sum + (b.price||0), 0);
  const totalCount = DB.bookings.length;
  const paidCount = DB.bookings.filter(b => b.paid).length;
  revenueSummary.innerHTML = `
    <div class="row">
      <div class="pill">總預約：${totalCount}</div>
      <div class="pill success">已付筆數：${paidCount}</div>
      <div class="pill">收入：$${totalPaid}</div>
    </div>
  `;

  // 提醒通知（前一天）
  reminderList.innerHTML = '';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate()+1);
  const tomorrowStr = fmtDate(tomorrow);
  const targets = DB.bookings.filter(b => b.date === tomorrowStr);
  if (targets.length === 0) {
    reminderList.innerHTML = '<div class="pill muted">明日無預約</div>';
  } else {
    for (const b of targets) {
      const msg = `提醒您明日 ${b.date} ${b.time} 的「${b.serviceName}」服務，地點：${b.location || '未提供'}。注意事項：${DB.settings.notes || '—'}。如需變更請提前告知，謝謝。`;
      const div = document.createElement('div');
      div.className = 'list-item';
      div.innerHTML = `
        <div>
          <div>${b.customer}（${b.phone}）</div>
          <div class="meta">${b.date} ${b.time} ・ ${b.serviceName} ・ 地點：${b.location || '—'}</div>
        </div>
        <div class="row">
          <button class="ghost" data-copy="${encodeURIComponent(msg)}">複製提醒內容</button>
          <button class="primary" data-lineshare="${encodeURIComponent(msg)}">用 LINE 分享</button>
        </div>
      `;
      reminderList.appendChild(div);
    }
    reminderList.querySelectorAll('button[data-copy]').forEach(b => {
      b.addEventListener('click', async () => {
        const txt = decodeURIComponent(b.getAttribute('data-copy'));
        try { await navigator.clipboard.writeText(txt); alert('已複製提醒內容'); }
        catch { prompt('複製失敗，請手動複製：', txt); }
      });
    });
    reminderList.querySelectorAll('button[data-lineshare]').forEach(b => {
      b.addEventListener('click', () => {
        const txt = decodeURIComponent(b.getAttribute('data-lineshare'));
        openLineShare(txt);
      });
    });
  }
}

// 設定與時段管理
const serviceForm = document.getElementById('service-form');
const serviceName = document.getElementById('service-name');
const serviceList = document.getElementById('service-list');
// 資料同步控制
const exportBtn = document.getElementById('export-data');
const importBtn = document.getElementById('import-data');
const importFile = document.getElementById('import-file');
const syncResult = document.getElementById('sync-result');

const settingsForm = document.getElementById('settings-form');
const settingLocation = document.getElementById('setting-location');
const settingNotes = document.getElementById('setting-notes');
const settingLineUrl = document.getElementById('setting-line-url');
const settingLiffId = document.getElementById('setting-liff-id');
const settingGoogleClientId = document.getElementById('setting-google-client-id');
const settingGoogleCalendarId = document.getElementById('setting-google-calendar-id');

const availabilityForm = document.getElementById('availability-form');
const availDate = document.getElementById('avail-date');
const availTime = document.getElementById('avail-time');
const availabilityList = document.getElementById('availability-list');
const generateMonthBtn = document.getElementById('generate-month');

function generateNextMonthSlots() {
  const today = new Date();
  const nextStart = new Date(today.getFullYear(), today.getMonth()+1, 1);
  const nextEnd = new Date(today.getFullYear(), today.getMonth()+2, 0);
  const times = [];
  for (let h=7; h<22; h++) { times.push(`${String(h).padStart(2,'0')}:00`); }
  for (let d = new Date(nextStart); d <= nextEnd; d.setDate(d.getDate()+1)) {
    const ds = fmtDate(d);
    const set = new Set(DB.availability[ds] || []);
    for (const t of times) set.add(t);
    DB.availability[ds] = Array.from(set).sort();
  }
  saveDB(DB);
  renderSettings();
  renderCalendar();
}
if (generateMonthBtn) {
  generateMonthBtn.addEventListener('click', () => {
    generateNextMonthSlots();
    alert('已生成未來一個月（每日 07:00–22:00）的一小時時段');
  });
}

function renderSettings() {
  // 服務列表
  serviceList.innerHTML = '';
  for (const s of DB.services) {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div>${s.name}</div>
      <div class="row">
        <button class="ghost" data-act="edit" data-id="${s.id}">修改</button>
        <button class="danger" data-act="del" data-id="${s.id}">刪除</button>
      </div>
    `;
    serviceList.appendChild(li);
  }
  serviceList.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      const idx = DB.services.findIndex(x => x.id === id);
      if (idx === -1) return;
      if (act === 'del') { DB.services.splice(idx,1); saveDB(DB); renderSettings(); renderBookForm(); }
      if (act === 'edit') {
        const newName = prompt('服務名稱', DB.services[idx].name);
        if (newName === null) return;
        DB.services[idx].name = newName.trim() || DB.services[idx].name;
        saveDB(DB); renderSettings(); renderBookForm();
      }
    });
  });

  // 設定表單
  settingLocation.value = DB.settings.location || '';
  settingNotes.value = DB.settings.notes || '';
  if (settingLineUrl) settingLineUrl.value = DB.settings.lineUrl || '';
  if (settingLiffId) settingLiffId.value = DB.settings.liffId || '';
  if (settingGoogleClientId) settingGoogleClientId.value = DB.settings.googleClientId || '';
  if (settingGoogleCalendarId) settingGoogleCalendarId.value = DB.settings.googleCalendarId || 'primary';
  const lineLink = document.getElementById('line-oa-link');
  if (lineLink) {
    if (DB.settings.lineUrl) {
      lineLink.innerHTML = `官方帳號：<a href="${DB.settings.lineUrl}" target="_blank">${DB.settings.lineUrl}</a>`;
    } else {
      lineLink.innerHTML = '（可設定 LINE 官方帳號網址，方便快速前往）';
    }
  }
  // 雲端同步設定表單填值
  const settingSyncEnabled = document.getElementById('setting-sync-enabled');
  const settingSyncKey = document.getElementById('setting-sync-key');
  const settingFirebaseApiKey = document.getElementById('setting-firebase-api-key');
  const settingFirebaseProjectId = document.getElementById('setting-firebase-project-id');
  const settingFirebaseAuthDomain = document.getElementById('setting-firebase-auth-domain');
  if (settingSyncEnabled) settingSyncEnabled.checked = !!DB.settings.syncEnabled;
  if (settingSyncKey) settingSyncKey.value = DB.settings.syncKey || '';
  if (settingFirebaseApiKey) settingFirebaseApiKey.value = DB.settings.firebaseApiKey || '';
  if (settingFirebaseProjectId) settingFirebaseProjectId.value = DB.settings.firebaseProjectId || '';
  if (settingFirebaseAuthDomain) settingFirebaseAuthDomain.value = DB.settings.firebaseAuthDomain || '';

  // 時段列表（按日期分組）
  availabilityList.innerHTML = '';
  const dates = Object.keys(DB.availability).sort();
  if (!dates.length) { availabilityList.innerHTML = '<div class="pill muted">尚未設定任何時段</div>'; }
  for (const d of dates) {
    const group = document.createElement('div');
    group.className = 'card';
    const slots = DB.availability[d];
    group.innerHTML = `
      <div class="row" style="justify-content:space-between;">
        <div><strong>${d}</strong> <span class="meta">可預約 ${slots.length} 檔</span></div>
        <div class="row">
          <button class="ghost" data-date="${d}" data-act="clear">清空當日</button>
        </div>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
        ${slots.map(s => `<span class="pill">${s}</span>`).join('')}
      </div>
    `;
    availabilityList.appendChild(group);
  }
  availabilityList.querySelectorAll('button[data-act="clear"]').forEach(b => {
    b.addEventListener('click', () => {
      const d = b.getAttribute('data-date');
      if (confirm(`清空 ${d} 的所有時段？`)) { delete DB.availability[d]; saveDB(DB); renderSettings(); renderCalendar(); }
    });
  });
}

serviceForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = serviceName.value.trim();
  if (!name) { alert('請輸入正確的服務名稱'); return; }
  DB.services.push({ id: id(), name, price: 0 });
  saveDB(DB); serviceForm.reset(); renderSettings(); renderBookForm();
});

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  DB.settings.location = settingLocation.value.trim();
  DB.settings.notes = settingNotes.value.trim();
  if (settingLineUrl) DB.settings.lineUrl = settingLineUrl.value.trim();
  if (settingLiffId) DB.settings.liffId = settingLiffId.value.trim();
  if (settingGoogleClientId) DB.settings.googleClientId = settingGoogleClientId.value.trim();
  if (settingGoogleCalendarId) DB.settings.googleCalendarId = (settingGoogleCalendarId.value || 'primary').trim() || 'primary';
  saveDB(DB);
  alert('已儲存設定');
});

availabilityForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = availDate.value; const t = availTime.value;
  if (!d || !t) { alert('請選擇日期與時間'); return; }
  DB.availability[d] = DB.availability[d] || [];
  if (!DB.availability[d].includes(t)) DB.availability[d].push(t);
  DB.availability[d].sort();
  saveDB(DB); availabilityForm.reset(); renderSettings(); renderCalendar();
});

function openLineShare(text) {
  const url = `line://msg/text/${encodeURIComponent(text)}`;
  try {
    window.location.href = url;
    // 若已設定官方帳號網址，亦開啟以便快速聯繫
    if (DB.settings.lineUrl) {
      setTimeout(() => { window.open(DB.settings.lineUrl, '_blank'); }, 600);
    }
  } catch (e) {
    if (DB.settings.lineUrl) { window.open(DB.settings.lineUrl, '_blank'); }
    else { alert('請於行動裝置上使用 LINE 分享，或先於設定填寫官方帳號網址'); }
  }
}

// 首次載入渲染
renderCalendar();
// 啟動雲端同步（若已在設定啟用）
initCloudSync();
// 登入（手機＋驗證碼）
const loginForm = document.getElementById('login-form');
const loginPhoneInput = document.getElementById('login-phone');
const loginResult = document.getElementById('login-result');

if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = (loginPhoneInput.value || '').trim();
    if (!isValidPhone(phone)) { loginResult.textContent = '請輸入正確的手機號碼'; return; }
    const isMerchant = (DB.settings && Array.isArray(DB.settings.adminPhones) && DB.settings.adminPhones.includes(phone)) || (location.hash.includes('login-admin'));
    DB.auth = { loggedIn: true, account: phone, phone, role: isMerchant ? 'merchant' : 'customer' };
    saveDB(DB);
    updateNavForAuth();
    updateHomeDashboard();
    const nextTarget = (DB.auth.role === 'merchant') ? '#admin' : '#calendar';
    loginResult.textContent = `登入成功，即將跳轉至${nextTarget === '#admin' ? '後台' : '日曆'}`;
    setTimeout(() => { location.hash = nextTarget; }, 300);
  });
}

// 註冊（手機 + 驗證碼）
const registerForm = document.getElementById('register-form');
const regPhone = document.getElementById('reg-phone');
const registerResult = document.getElementById('register-result');

// 驗證碼流程已移除（保留占位，未使用）

function isValidPhone(p) { return /^[0-9\-\s]{8,}$/.test(p || ''); }

if (registerForm) {
  registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const phone = (regPhone.value || '').trim();
    if (!isValidPhone(phone)) { registerResult.textContent = '請輸入正確的手機號碼'; return; }
    // 註冊成功：建立登入狀態，以電話作為帳號識別
    DB.auth = { loggedIn: true, account: phone, phone, role: ((DB.settings && Array.isArray(DB.settings.adminPhones) && DB.settings.adminPhones.includes(phone)) ? 'merchant' : 'customer') };
    // 可選：將使用者加入名單（無密碼）
    DB.users = DB.users || [];
    if (!DB.users.find(u => u.account === phone)) { DB.users.push({ account: phone, password: '' }); }
    saveDB(DB);
    updateNavForAuth();
    registerResult.textContent = '註冊成功，已自動登入';
    const nextTarget = (DB.auth.role === 'merchant') ? '#admin' : '#calendar';
    setTimeout(() => { location.hash = nextTarget; }, 300);
  });
}

// 雲端自動同步：設定表單提交綁定
const cloudForm = document.getElementById('cloud-form');
if (cloudForm) {
  cloudForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const settingSyncEnabled = document.getElementById('setting-sync-enabled');
    const settingSyncKey = document.getElementById('setting-sync-key');
    const settingFirebaseApiKey = document.getElementById('setting-firebase-api-key');
    const settingFirebaseProjectId = document.getElementById('setting-firebase-project-id');
    const settingFirebaseAuthDomain = document.getElementById('setting-firebase-auth-domain');
    DB.settings.syncEnabled = !!(settingSyncEnabled && settingSyncEnabled.checked);
    DB.settings.syncKey = (settingSyncKey && settingSyncKey.value || '').trim();
    DB.settings.firebaseApiKey = (settingFirebaseApiKey && settingFirebaseApiKey.value || '').trim();
    DB.settings.firebaseProjectId = (settingFirebaseProjectId && settingFirebaseProjectId.value || '').trim();
    DB.settings.firebaseAuthDomain = (settingFirebaseAuthDomain && settingFirebaseAuthDomain.value || '').trim();
    saveDB(DB);
    initCloudSync();
    setCloudStatus('已儲存設定並啟用（如條件符合）');
  });
}

// 若已登入，預填預約表單電話
// 可選：若需以帳號關聯電話，可在設定或個人資料頁補充，不再於登入時預填電話

// 我的預約
function toDateTime(dateStr, timeStr) {
  const d = parseDateStr(dateStr);
  if (!d) return null;
  const parts = (timeStr || '00:00').split(':');
  d.setHours(Number(parts[0]||0), Number(parts[1]||0), 0, 0);
  return d;
}
function renderMyBookings() {
  const upEl = document.getElementById('my-upcoming');
  const histEl = document.getElementById('my-history');
  if (!upEl || !histEl) return;
  const phone = DB.auth && DB.auth.phone;
  if (!phone) { upEl.innerHTML = '<div class="meta">請先登入以查看你的預約</div>'; histEl.innerHTML = ''; return; }
  const now = new Date();
  const mine = (DB.bookings || []).filter(b => (b.phone||'').trim() === phone.trim());
  mine.sort((a,b) => (toDateTime(a.date,a.time) - toDateTime(b.date,b.time)));
  const upcoming = mine.filter(b => toDateTime(b.date,b.time) >= now);
  const history = mine.filter(b => toDateTime(b.date,b.time) < now);
  function renderList(list) {
    if (!list.length) return '<div class="meta">目前沒有資料</div>';
    return '<ul class="list">' + list.map(b => {
      const when = `${b.date} ${b.time || ''}`;
      const title = `${b.serviceName || '課程'} - ${b.customer || ''}`;
      const note = b.notes ? `<div class="meta">${b.notes}</div>` : '';
      const loc = DB.settings.location || '';
      return `<li class="list-item"><div class="list-main"><div class="list-title">${title}</div><div class="list-sub">${when} @ ${loc}</div>${note}</div></li>`;
    }).join('') + '</ul>';
  }
  upEl.innerHTML = renderList(upcoming);
  histEl.innerHTML = renderList(history);
}
// Google 行事曆整合：載入、授權、建立事件與備援
async function loadGapiAndInit() {
  if (!DB.settings.googleClientId) throw new Error('缺少 Google Client ID');
  if (!window.gapi) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://apis.google.com/js/api.js';
      s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  await new Promise((resolve) => { window.gapi.load('client:auth2', resolve); });
  const discoveryDocs = ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'];
  await window.gapi.client.init({ clientId: DB.settings.googleClientId, scope: 'https://www.googleapis.com/auth/calendar.events', discoveryDocs });
  const auth = window.gapi.auth2.getAuthInstance();
  if (!auth.isSignedIn.get()) { await auth.signIn(); }
}

function toEventTimes(dateStr, timeStr, mins = 60) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Taipei';
  const start = new Date(`${dateStr}T${timeStr}:00`);
  const end = new Date(start.getTime() + mins * 60000);
  return { start, end, timeZone: tz };
}

async function insertEventViaAPI(booking) {
  await loadGapiAndInit();
  const calId = DB.settings.googleCalendarId || 'primary';
  const t = toEventTimes(booking.date, booking.time, 60);
  const resource = {
    summary: `${booking.serviceName}｜${booking.customer}`,
    description: `${booking.notes || ''}`,
    location: booking.location || '',
    start: { dateTime: t.start.toISOString(), timeZone: t.timeZone },
    end: { dateTime: t.end.toISOString(), timeZone: t.timeZone },
    attendees: booking.email ? [{ email: booking.email }] : [],
  };
  const params = { calendarId: calId, resource, sendUpdates: 'all' };
  await window.gapi.client.calendar.events.insert(params);
}

function openGoogleTemplate(booking) {
  const t = toEventTimes(booking.date, booking.time, 60);
  const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}T${String(d.getUTCHours()).padStart(2,'0')}${String(d.getUTCMinutes()).padStart(2,'0')}00Z`;
  const dates = `${fmt(t.start)}/${fmt(t.end)}`;
  const url = new URL('https://calendar.google.com/calendar/u/0/r/eventedit');
  url.searchParams.set('text', `${booking.serviceName}｜${booking.customer}`);
  url.searchParams.set('dates', dates);
  url.searchParams.set('details', booking.notes || '');
  url.searchParams.set('location', booking.location || '');
  if (booking.email) url.searchParams.set('add', booking.email);
  window.open(url.toString(), '_blank');
}

function downloadIcs(booking) {
  const t = toEventTimes(booking.date, booking.time, 60);
  const pad = (n) => String(n).padStart(2,'0');
  const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//BookingApp//EN','BEGIN:VEVENT',
    `UID:${booking.id}@bookingapp.local`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(t.start)}`,
    `DTEND:${utc(t.end)}`,
    `SUMMARY:${booking.serviceName}｜${booking.customer}`,
    `DESCRIPTION:${(booking.notes||'').replace(/\n/g,'\\n')}`,
    `LOCATION:${booking.location||''}`,
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `booking-${booking.id}.ics`;
  a.click();
}

async function maybeAddToGoogleCalendar(booking) {
  try {
    if (DB.settings.googleClientId) {
      await insertEventViaAPI(booking);
      return;
    }
  } catch (e) {
    console.warn('Google API 插入事件失敗：', e);
  }
  openGoogleTemplate(booking);
  downloadIcs(booking);
}
// 匯出／匯入：提供跨裝置手動同步
function exportData() {
  try {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'bookingapp-data.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (syncResult) syncResult.textContent = '已匯出資料（JSON 檔）。';
  } catch (e) {
    console.error(e); if (syncResult) syncResult.textContent = '匯出失敗。';
  }
}
function importDataFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      // 基本驗證
      if (!data || typeof data !== 'object') throw new Error('格式錯誤');
      // 以新資料覆蓋
      DB = data;
      saveDB(DB);
      // 重新渲染各視圖
      renderSettings();
      renderCalendar();
      renderAdmin();
      updateNavForAuth();
      updateHomeDashboard();
      if (syncResult) syncResult.textContent = '匯入成功，資料已更新。';
    } catch (e) {
      console.error(e); if (syncResult) syncResult.textContent = '匯入失敗，請確認 JSON 格式。';
    }
  };
  reader.readAsText(file);
}
if (exportBtn) exportBtn.addEventListener('click', exportData);
if (importBtn && importFile) {
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', () => importDataFromFile(importFile.files?.[0]));
}