// ui.js - פונקציות ממשק משותפות לכל הדפים

// ─────────────────────────────────────────────
// פורמט זמן (ירושלים)
// ─────────────────────────────────────────────

const JER_TZ = 'Asia/Jerusalem';

/**
 * פורמט תאריך + שעה בעברית
 */
export function formatDateTime(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(isoString));
}

/**
 * פורמט שעה בלבד
 */
export function formatTime(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ,
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(isoString));
}

/**
 * פורמט תאריך בלבד
 */
export function formatDate(isoString) {
  if (!isoString) return '—';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: JER_TZ,
    day: '2-digit', month: '2-digit', year: 'numeric'
  }).format(new Date(isoString));
}

/**
 * פורמט דקות → "Xש' Yד'"
 */
export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}ד'`;
  if (m === 0) return `${h}ש'`;
  return `${h}ש' ${m}ד'`;
}

/**
 * ערך datetime-local (input) לפי אזור זמן ירושלים
 */
export function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: JER_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(d);
  return parts.replace(' ', 'T');
}

/**
 * המרת input datetime-local → ISO string
 */
export function fromLocalInputValue(localStr) {
  if (!localStr) return null;
  // sv-SE format: "YYYY-MM-DDTHH:MM"
  const [datePart, timePart] = localStr.split('T');
  const [year, month, day] = datePart.split('-');
  const [hour, minute] = (timePart || '00:00').split(':');
  // יצירת Date באזור ירושלים
  const d = new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute)
  ));
  // פיצוי אזור זמן
  const offset = getJerusalemOffset(d);
  return new Date(d.getTime() - offset * 60000).toISOString();
}

function getJerusalemOffset(date) {
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: JER_TZ,
    hour: 'numeric', hour12: false,
    timeZoneName: 'shortOffset'
  }).formatToParts(date);
  const tzPart = local.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
  const match = tzPart.match(/GMT([+-])(\d+)(?::(\d+))?/);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  return sign * (parseInt(match[2]) * 60 + parseInt(match[3] || '0'));
}

// ─────────────────────────────────────────────
// Toast notifications
// ─────────────────────────────────────────────

let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.style.cssText = `
      position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
      z-index: 9999; display: flex; flex-direction: column; gap: 0.5rem;
      pointer-events: none; min-width: 280px;
    `;
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * הצגת הודעת toast
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration - מילישניות
 */
export function showToast(message, type = 'info', duration = 3000) {
  const colors = {
    success: '#198754',
    error: '#dc3545',
    warning: '#ffc107',
    info: '#0dcaf0'
  };
  const icons = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    background: ${colors[type] || colors.info};
    color: ${type === 'warning' ? '#000' : '#fff'};
    padding: 0.75rem 1.25rem;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    pointer-events: auto;
    opacity: 0;
    transition: opacity 0.3s;
    direction: rtl;
    text-align: center;
  `;
  toast.innerHTML = `${icons[type]} ${message}`;

  getToastContainer().appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─────────────────────────────────────────────
// מודל אישור מחיקה
// ─────────────────────────────────────────────

/**
 * הצגת מודל אישור
 * @param {string} message
 * @param {string} confirmText
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, confirmText = 'אישור') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      z-index: 10000; display: flex; align-items: center; justify-content: center;
    `;

    overlay.innerHTML = `
      <div style="
        background: #1e2530; border: 1px solid #3a4553; border-radius: 12px;
        padding: 1.5rem; max-width: 320px; width: 90%; text-align: center; direction: rtl;
      ">
        <p style="color: #e0e6ef; margin-bottom: 1.25rem; font-size: 1rem;">${message}</p>
        <div style="display: flex; gap: 0.75rem; justify-content: center;">
          <button id="confirmYes" style="
            background: #dc3545; color: #fff; border: none; padding: 0.5rem 1.5rem;
            border-radius: 6px; font-size: 0.9rem; cursor: pointer;
          ">${confirmText}</button>
          <button id="confirmNo" style="
            background: #3a4553; color: #e0e6ef; border: none; padding: 0.5rem 1.5rem;
            border-radius: 6px; font-size: 0.9rem; cursor: pointer;
          ">ביטול</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#confirmYes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#confirmNo').onclick = () => { overlay.remove(); resolve(false); };
  });
}

// ─────────────────────────────────────────────
// כלי UI נוספים
// ─────────────────────────────────────────────

/**
 * יצירת badge פק"ל
 */
export function roleBadge(roleName) {
  return `<span style="
    background: rgba(255,193,7,0.15); color: #ffc107;
    border: 1px solid rgba(255,193,7,0.3);
    padding: 1px 6px; border-radius: 4px; font-size: 0.72rem;
    white-space: nowrap;
  ">${roleName}</span>`;
}

/**
 * יצירת נקודת צבע מחלקה
 */
export function groupDot(colorHex) {
  return `<span style="
    display: inline-block; width: 8px; height: 8px;
    border-radius: 50%; background: ${colorHex || '#6c757d'};
    margin-left: 4px; flex-shrink: 0;
  "></span>`;
}

/**
 * badge סטטוס מנוחה
 */
export function restBadge(restMins, minRestMins, isForced) {
  if (isForced) return `<span class="badge" style="background:#dc3545">כפוי</span>`;
  if (restMins === null) return `<span class="badge" style="background:#6c757d">ראשון</span>`;
  if (restMins < minRestMins) return `<span class="badge" style="background:#fd7e14">${formatMinutes(restMins)}</span>`;
  return `<span class="badge" style="background:#198754">${formatMinutes(restMins)}</span>`;
}

/**
 * spinner טעינה
 */
export function showLoader(containerId, message = 'טוען...') {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div class="text-center py-4" style="color:#8899aa;">
      <div class="spinner-border spinner-border-sm mb-2" role="status"></div>
      <div>${message}</div>
    </div>
  `;
}

/**
 * הצגת שגיאה בcontainer
 */
export function showError(containerId, message) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div class="alert" style="background:rgba(220,53,69,0.15); color:#ea868f; border-color:rgba(220,53,69,0.3);">
      ⚠ ${message}
    </div>
  `;
}

/**
 * ניווט - סימון עמוד פעיל
 */
export function setActiveNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href') || '';
    link.classList.toggle('active', href.includes(path));
  });
}

/**
 * פלטת צבעים מוכנות לבחירה
 */
export const COLOR_PALETTE = [
  '#007bff', '#28a745', '#dc3545', '#ffc107', '#17a2b8',
  '#6f42c1', '#fd7e14', '#20c997', '#e83e8c', '#6c757d',
  '#0d6efd', '#198754', '#0dcaf0', '#d63384', '#f0ad4e'
];

/**
 * יצירת color picker עם פלטה מוכנה
 */
export function createColorPicker(currentColor, onChange) {
  const container = document.createElement('div');
  container.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;';

  COLOR_PALETTE.forEach(color => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.style.cssText = `
      width: 24px; height: 24px; border-radius: 50%;
      background: ${color}; border: 2px solid transparent;
      cursor: pointer; padding: 0; transition: border-color 0.2s;
    `;
    if (color === currentColor) swatch.style.borderColor = '#fff';
    swatch.onclick = () => {
      container.querySelectorAll('button').forEach(b => b.style.borderColor = 'transparent');
      swatch.style.borderColor = '#fff';
      onChange(color);
    };
    container.appendChild(swatch);
  });

  // custom color input
  const input = document.createElement('input');
  input.type = 'color';
  input.value = currentColor || '#007bff';
  input.style.cssText = 'width: 28px; height: 28px; border: none; background: none; cursor: pointer; padding: 0;';
  input.oninput = () => onChange(input.value);
  container.appendChild(input);

  return container;
}
