// ui.js - פונקציות ממשק משותפות לכל הדפים
// גרסה 2.0

// ─────────────────────────────────────────────
// קבועים
// ─────────────────────────────────────────────

export const APP_VERSION = '4.0';
const JER_TZ = 'Asia/Jerusalem';

export const COLOR_PALETTE = [
  '#2563eb','#16a34a','#dc2626','#d97706','#0891b2',
  '#7c3aed','#ea580c','#0d9488','#db2777','#64748b',
  '#1d4ed8','#15803d','#b91c1c','#b45309','#0e7490'
];

// ─────────────────────────────────────────────
// ערכת נושא (Theme)
// ─────────────────────────────────────────────

export function initTheme() {
  const saved = localStorage.getItem('shavtzak_theme') || 'light';
  applyTheme(saved);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('shavtzak_theme', theme);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

// ─────────────────────────────────────────────
// גודל טקסט
// ─────────────────────────────────────────────

const FONT_SIZES = { small: '12px', medium: '14px', large: '16px', xlarge: '18px' };

export function initFontSize() {
  const saved = localStorage.getItem('shavtzak_fontsize') || 'medium';
  applyFontSize(saved);
}

export function applyFontSize(size) {
  document.documentElement.style.setProperty('--font-size-base', FONT_SIZES[size] || '14px');
  localStorage.setItem('shavtzak_fontsize', size);
}

export function getCurrentFontSize() {
  return localStorage.getItem('shavtzak_fontsize') || 'medium';
}

// ─────────────────────────────────────────────
// פורמט זמן
// ─────────────────────────────────────────────

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));
}

export function formatTime(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ, hour: '2-digit', minute: '2-digit'
  }).format(new Date(iso));
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ, day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(iso));
}

export function formatDayName(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ, weekday: 'long'
  }).format(new Date(iso));
}

export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}ד'`;
  if (m === 0) return `${h}ש'`;
  return `${h}ש' ${m}ד'`;
}

export function formatCountdown(targetISO) {
  const diff = new Date(targetISO) - new Date();
  if (diff <= 0) return 'עכשיו';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `עוד ${h}ש' ${m}ד'`;
  return `עוד ${m}ד'`;
}

export function toLocalInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: JER_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
  return parts.replace(' ', 'T');
}

export function fromLocalInputValue(local) {
  if (!local) return null;
  const [date, time] = local.split('T');
  const [y, mo, d] = date.split('-');
  const [h, mi] = (time || '00:00').split(':');
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:00`).toISOString();
}

// ─────────────────────────────────────────────
// Toast הודעות
// ─────────────────────────────────────────────

let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TOAST_ICONS = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };

export function showToast(message, type = 'info', duration = 3000) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${TOAST_ICONS[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px) scale(0.95)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─────────────────────────────────────────────
// Confirm dialog
// ─────────────────────────────────────────────

export function confirmDialog(message, confirmText = 'אישור', type = 'danger') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.style.alignItems = 'center';

    const btnClass = type === 'danger' ? 'btn-danger' : 'btn-primary';

    overlay.innerHTML = `
      <div style="
        background: var(--bg-card);
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        padding: 1.5rem 1.25rem;
        width: 88%;
        max-width: 320px;
        text-align: center;
        animation: slideUp 0.25s ease;
        box-shadow: var(--shadow-lg);
      ">
        <div style="font-size:1.8rem;margin-bottom:0.75rem;">⚠️</div>
        <p style="color:var(--text-sub);font-size:0.9rem;margin-bottom:1.25rem;line-height:1.5;">${message}</p>
        <div style="display:flex;gap:0.5rem;justify-content:center;">
          <button id="cfmYes" class="btn ${btnClass}">${confirmText}</button>
          <button id="cfmNo"  class="btn btn-secondary">ביטול</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    overlay.querySelector('#cfmYes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#cfmNo').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

// ─────────────────────────────────────────────
// ניווט תחתון
// ─────────────────────────────────────────────

const NAV_ITEMS = [
  { href: 'index.html',       icon: '📋', label: 'לוח' },
  { href: 'shifts.html',      icon: '🗓', label: 'שיבוץ' },
  { href: 'soldiers.html',    icon: '👤', label: 'חיילים' },
  { href: 'posts.html',       icon: '🏰', label: 'עמדות' },
  { href: 'settings.html',    icon: '⚙️', label: 'הגדרות' },
];

export function renderBottomNav() {
  const current = window.location.pathname.split('/').pop() || 'index.html';

  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = NAV_ITEMS.map(item => `
    <a href="${item.href}" class="nav-item ${current.includes(item.href.replace('.html','')) ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>`).join('');
  document.body.appendChild(nav);
}

// ─────────────────────────────────────────────
// באנר offline
// ─────────────────────────────────────────────

export function initOfflineBanner() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.innerHTML = '⚠ אין חיבור לאינטרנט — מציג נתונים שמורים';
  document.body.insertBefore(banner, document.body.firstChild);

  const update = () => banner.classList.toggle('show', !navigator.onLine);
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ─────────────────────────────────────────────
// באנר עדכון
// ─────────────────────────────────────────────

export function showUpdateBanner(version, apkUrl) {
  const existing = document.getElementById('update-banner');
  if (existing) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner show';
  banner.innerHTML = `
    <span>🆕 גרסה ${version} זמינה!</span>
    <a href="${apkUrl}" class="btn btn-success btn-sm" target="_blank">עדכן עכשיו</a>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--green);font-size:1rem;">×</button>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
}

// ─────────────────────────────────────────────
// בדיקת עדכון (נקרא מכל דף)
// ─────────────────────────────────────────────

// בדיקת עדכון — מציג באנר רק פעם אחת בכניסה הראשונה לאחר גרסה חדשה
// לאחר הצגה — מסתיר. הורדה זמינה דרך הגדרות בלבד.
export async function checkAndShowUpdate(currentVersion) {
  try {
    const { checkForUpdate } = await import('./firebase.js');
    const result = await checkForUpdate(currentVersion);
    if (result?.hasUpdate) {
      // מפתח ייחודי לכל גרסה + גרסה נוכחית (כך שבעדכון אמיתי המפתח משתנה)
      const shownKey = `shavtzak_upd_shown_${currentVersion}_to_${result.version}`;
      if (!localStorage.getItem(shownKey)) {
        showUpdateBanner(result.version, result.apkUrl);
        localStorage.setItem(shownKey, '1');
      }
      // שמור פרטי עדכון להגדרות
      localStorage.setItem('shavtzak_pending_update', JSON.stringify({
        version: result.version,
        apkUrl:  result.apkUrl
      }));
    } else {
      // אין עדכון — נקה pending
      localStorage.removeItem('shavtzak_pending_update');
    }
    return result;
  } catch { return null; }
}

// קריאה מדף הגדרות: מחזיר { version, apkUrl } אם יש עדכון ממתין, אחרת null
export function getPendingUpdate() {
  try {
    const raw = localStorage.getItem('shavtzak_pending_update');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────
// אתחול כל דף
// ─────────────────────────────────────────────

export function initPage() {
  initTheme();
  initFontSize();
  renderBottomNav();
  initOfflineBanner();
  // בדיקת עדכון רק בדף הראשי ורק פעם אחת
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (page === 'index.html' || page === '') {
    checkAndShowUpdate(APP_VERSION);
  }
}

// ─────────────────────────────────────────────
// badge / עזרי UI
// ─────────────────────────────────────────────

export function restBadge(restMins, minRest, isForced) {
  if (isForced)          return `<span class="badge badge-red">כפוי</span>`;
  if (restMins === null) return `<span class="badge badge-gray">ראשון</span>`;
  if (restMins < minRest) return `<span class="badge badge-yellow">${formatMinutes(restMins)}</span>`;
  return `<span class="badge badge-green">${formatMinutes(restMins)}</span>`;
}

export function groupDot(colorHex, size = 10) {
  return `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${colorHex || '#9ca3af'};flex-shrink:0;"></span>`;
}

export function roleBadge(name) {
  return `<span class="badge badge-yellow">${name}</span>`;
}

export function lockIcon(isLocked) {
  return isLocked ? '🔒' : '🔓';
}

// ─────────────────────────────────────────────
// Color picker
// ─────────────────────────────────────────────

export function createColorPicker(currentColor, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;';

  COLOR_PALETTE.forEach(c => {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.style.cssText = `width:24px;height:24px;border-radius:50%;background:${c};border:2.5px solid ${c === currentColor ? '#fff' : 'transparent'};cursor:pointer;padding:0;transition:border-color 0.15s;box-shadow:0 1px 3px rgba(0,0,0,0.15);`;
    sw.onclick = () => {
      wrap.querySelectorAll('button').forEach(b => b.style.borderColor = 'transparent');
      sw.style.borderColor = '#fff';
      onChange(c);
    };
    wrap.appendChild(sw);
  });

  const custom = document.createElement('input');
  custom.type = 'color';
  custom.value = currentColor || '#2563eb';
  custom.style.cssText = 'width:28px;height:28px;border:none;background:none;cursor:pointer;padding:0;border-radius:50%;';
  custom.oninput = () => onChange(custom.value);
  wrap.appendChild(custom);
  return wrap;
}

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

export function showLoader(containerId, message = 'טוען...') {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div style="text-align:center;padding:3rem;color:var(--text-muted);">
      <div class="spinner" style="margin:0 auto 1rem;"></div>
      <div style="font-size:0.85rem;">${message}</div>
    </div>`;
}

export function showEmptyState(containerId, icon, title, desc, actionHtml = '') {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">${icon}</div>
      <div class="empty-title">${title}</div>
      <div class="empty-desc">${desc}</div>
      ${actionHtml}
    </div>`;
}
