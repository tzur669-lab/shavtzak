// logic.js - אלגוריתם שיבוץ
// כל הלוגיקה של יצירת משמרות ושיבוץ חיילים

import {
  getSettings,
  getPosts,
  getSoldiers,
  getShifts,
  getShiftsInRange,
  deleteShiftsInRange,
  clearSoldiersInRange,
  saveShiftsBatch,
  updateShift
} from './firebase.js';

// ─────────────────────────────────────────────
// קבועים
// ─────────────────────────────────────────────

const MIN_SHIFT_MINUTES = 30; // הגנה מפני משמרות קצרות מדי
const SPECIALIST_WINDOW_MINUTES = 240; // חלון לבדיקת חובש שמור

// ─────────────────────────────────────────────
// כלי עזר לזמן
// ─────────────────────────────────────────────

/**
 * הפרש בדקות בין שני ISO strings
 */
function diffMinutes(isoA, isoB) {
  return (new Date(isoB) - new Date(isoA)) / 60000;
}

/**
 * הוספת דקות ל-ISO string
 */
function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

/**
 * זמן נוכחי כ-ISO בירושלים (לצרכי לוג בלבד)
 */
function nowISO() {
  return new Date().toISOString();
}

// ─────────────────────────────────────────────
// שלב 1 - יצירת משבצות ריקות
// ─────────────────────────────────────────────

/**
 * יצירת כל המשמרות הריקות בטווח לפי הגדרות העמדות
 * @param {Array} posts
 * @param {string} startISO
 * @param {string} endISO
 * @returns {Array} רשימת אובייקטי משמרת ריקים (טרם נשמרו)
 */
function buildEmptyShifts(posts, startISO, endISO) {
  const result = [];

  for (const post of posts) {
    const requirements = post.requirements
      ? Object.entries(post.requirements).map(([id, data]) => ({ id, ...data }))
      : [];

    if (requirements.length === 0) continue;

    const durationMins = Math.max(post.duration_minutes || 60, MIN_SHIFT_MINUTES);
    let cursor = startISO;

    while (cursor < endISO) {
      const shiftEnd = addMinutes(cursor, durationMins);
      // אל תיצור משמרת שנגמרת אחרי endISO
      const actualEnd = shiftEnd > endISO ? endISO : shiftEnd;

      // הגנה: לפחות 30 דקות
      if (diffMinutes(cursor, actualEnd) < MIN_SHIFT_MINUTES) break;

      for (const req of requirements) {
        result.push({
          post_id: post.id,
          requirement_id: req.id,
          soldier_id: null,
          start_time: cursor,
          end_time: actualEnd,
          rest_before_minutes: null,
          is_forced: false
        });
      }

      cursor = actualEnd;
      if (cursor >= endISO) break;
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// שלב 3 - אלגוריתם שיבוץ
// ─────────────────────────────────────────────

/**
 * בדיקה אם חייל עסוק בזמן נתון
 */
function isBusy(soldier, startISO, endISO, allShifts) {
  return allShifts.some(s =>
    s.soldier_id === soldier.id &&
    s.start_time < endISO &&
    s.end_time > startISO
  );
}

/**
 * מציאת המשמרת האחרונה של חייל לפני זמן נתון
 */
function getLastShiftBefore(soldierId, beforeISO, allShifts) {
  const prev = allShifts
    .filter(s => s.soldier_id === soldierId && s.end_time <= beforeISO)
    .sort((a, b) => b.end_time.localeCompare(a.end_time));
  return prev[0] || null;
}

/**
 * חישוב ציון מנוחה לחייל
 */
function calcScore(soldier, shift, allShifts, restCalc, resetHistory) {
  const lastShift = getLastShiftBefore(soldier.id, shift.start_time, allShifts);

  // חייל שלא שמר מעולם, או שמשמרתו לפני startTime ו-resetHistory=true
  if (!lastShift) return 999999;
  if (resetHistory && lastShift.start_time < shift.start_time) return 999999;

  const restMins = diffMinutes(lastShift.end_time, shift.start_time);

  if (restCalc === 'relative') {
    const lastDuration = diffMinutes(lastShift.start_time, lastShift.end_time);
    return lastDuration > 0 ? restMins / lastDuration : restMins;
  }

  return restMins; // 'regular'
}

/**
 * בדיקת לוגיקת "חובש שמור" -
 * האם לא לשבץ חייל מוסמך למשמרת כללית כדי לשמור אותו לעמדה מתמחה
 */
function shouldReserveSpecialist(soldier, shift, posts, allShifts, soldiers) {
  if (!soldier.roles || soldier.roles.length === 0) return false;

  // בדיקה רק למשמרת כללית (ללא דרישת פק"ל)
  const post = posts.find(p => p.id === shift.post_id);
  if (!post) return false;
  const req = post.requirements?.[shift.requirement_id];
  if (req?.required_role_id) return false; // המשמרת עצמה דורשת פק"ל → לא שמור

  const windowEnd = addMinutes(shift.start_time, SPECIALIST_WINDOW_MINUTES);

  for (const roleId of soldier.roles) {
    // מניין משמרות דורשות פק"ל זה בחלון הזמן
    let demandCount = 0;
    for (const p of posts) {
      const reqs = p.requirements ? Object.values(p.requirements) : [];
      for (const r of reqs) {
        if (r.required_role_id === roleId) {
          // האם יש משמרת כזו בחלון?
          const matchingShifts = allShifts.filter(s =>
            s.post_id === p.id &&
            s.requirement_id && // יש requirement
            s.start_time >= shift.start_time &&
            s.start_time < windowEnd &&
            s.soldier_id === null
          );
          demandCount += matchingShifts.length;
        }
      }
    }

    // מניין חיילים מוסמכים פעילים עם פק"ל זה
    const qualifiedCount = soldiers.filter(sol =>
      sol.is_active &&
      sol.roles?.includes(roleId)
    ).length;

    if (qualifiedCount <= demandCount) return true; // שמור!
  }

  return false;
}

/**
 * שיבוץ חייל יחיד למשמרת
 * @returns {{ soldierId: string|null, restMins: number|null, isForced: boolean }}
 */
function assignBestSoldier(shift, soldiers, posts, allShifts, options) {
  const { restCalc, resetHistory, shortageAction, minRestMinutes } = options;

  // ─ סינון מועמדים ─
  const candidates = soldiers.filter(s => {
    if (!s.is_active) return false;
    if (s.return_to_service_time && new Date(s.return_to_service_time) > new Date(shift.start_time)) return false;
    if (isBusy(s, shift.start_time, shift.end_time, allShifts)) return false;

    // בדיקת דרישת פק"ל
    const post = posts.find(p => p.id === shift.post_id);
    const req = post?.requirements?.[shift.requirement_id];
    if (req?.required_role_id) {
      if (!s.roles?.includes(req.required_role_id)) return false;
    }

    return true;
  });

  if (candidates.length === 0) return { soldierId: null, restMins: null, isForced: false };

  // ─ סינון חובשים שמורים ─
  const nonReserved = candidates.filter(s =>
    !shouldReserveSpecialist(s, shift, posts, allShifts, soldiers)
  );
  const pool = nonReserved.length > 0 ? nonReserved : candidates;

  // ─ חישוב ציונים ─
  const scored = pool.map(s => ({
    soldier: s,
    score: calcScore(s, shift, allShifts, restCalc, resetHistory),
    restMins: (() => {
      const last = getLastShiftBefore(s.id, shift.start_time, allShifts);
      return last ? diffMinutes(last.end_time, shift.start_time) : null;
    })()
  })).sort((a, b) => b.score - a.score);

  // ─ בחירה ─
  const legal = scored.filter(c => c.score === 999999 || (c.restMins !== null && c.restMins >= minRestMinutes));

  if (legal.length > 0) {
    const best = legal[0];
    return { soldierId: best.soldier.id, restMins: best.restMins, isForced: false };
  }

  if (shortageAction === 'force' && scored.length > 0) {
    const best = scored[0];
    return { soldierId: best.soldier.id, restMins: best.restMins, isForced: true };
  }

  return { soldierId: null, restMins: null, isForced: false };
}

// ─────────────────────────────────────────────
// פונקציה ראשית - generateShifts
// ─────────────────────────────────────────────

/**
 * @param {string} startISO - תחילת הטווח
 * @param {string} endISO - סיום הטווח
 * @param {string} shortageAction - 'empty' | 'force'
 * @param {string} restCalc - 'regular' | 'relative'
 * @param {boolean} resetHistory - התעלם ממשמרות לפני startISO
 * @param {string} runMode - 'new' | 'reassign' | 'holes'
 * @param {Function} progressCallback - קריאת עדכון התקדמות (אחוז, הודעה)
 * @returns {Promise<{ assigned: number, forced: number, empty: number, total: number }>}
 */
export async function generateShifts(
  startISO,
  endISO,
  shortageAction = 'empty',
  restCalc = 'regular',
  resetHistory = false,
  runMode = 'new',
  progressCallback = null
) {
  const progress = (pct, msg) => {
    if (progressCallback) progressCallback(pct, msg);
  };

  progress(0, 'טוען נתונים...');

  // ─ טעינת כל הנתונים ─
  const [settings, posts, soldiers, allShifts] = await Promise.all([
    getSettings(),
    getPosts(),
    getSoldiers(),
    getShifts()
  ]);

  const minRestMinutes = settings.min_rest_minutes ?? 240;
  const options = { shortageAction, restCalc, resetHistory, minRestMinutes };

  progress(10, 'מכין משמרות...');

  // ─ שלב 1/2 לפי runMode ─
  let shiftsToAssign = [];

  if (runMode === 'new') {
    // מחיקת משמרות קיימות בטווח
    progress(15, 'מוחק משמרות קיימות...');
    await deleteShiftsInRange(startISO, endISO);

    // יצירת משבצות ריקות
    const emptyShifts = buildEmptyShifts(posts, startISO, endISO);
    progress(25, `נוצרו ${emptyShifts.length} משמרות. שומר...`);
    await saveShiftsBatch(emptyShifts);

    // טעינה מחדש כדי לקבל IDs
    shiftsToAssign = await getShiftsInRange(startISO, endISO);

  } else if (runMode === 'reassign') {
    // ריקון חיילים קיימים
    progress(15, 'מרוקן שיבוצים...');
    await clearSoldiersInRange(startISO, endISO);
    shiftsToAssign = await getShiftsInRange(startISO, endISO);

  } else if (runMode === 'holes') {
    // רק משמרות ריקות
    const inRange = await getShiftsInRange(startISO, endISO);
    shiftsToAssign = inRange.filter(s => !s.soldier_id);
  }

  progress(30, `משבץ ${shiftsToAssign.length} משמרות...`);

  // מיון לפי זמן התחלה
  shiftsToAssign.sort((a, b) => a.start_time.localeCompare(b.start_time));

  // ─ שלב 3 - שיבוץ ─
  let assigned = 0, forced = 0, empty = 0;
  const updatedShifts = [...allShifts]; // עותק עובד - מתעדכן תוך כדי שיבוץ

  for (let i = 0; i < shiftsToAssign.length; i++) {
    const shift = shiftsToAssign[i];
    const pct = 30 + Math.floor((i / shiftsToAssign.length) * 65);
    if (i % 5 === 0) progress(pct, `משבץ משמרת ${i + 1} מתוך ${shiftsToAssign.length}...`);

    const result = assignBestSoldier(shift, soldiers, posts, updatedShifts, options);

    if (result.soldierId) {
      const updated = {
        soldier_id: result.soldierId,
        rest_before_minutes: result.restMins,
        is_forced: result.isForced,
        updated_at: nowISO()
      };
      await updateShift(shift.id, updated);

      // עדכון הרשימה המקומית לשיבוצים הבאים
      const idx = updatedShifts.findIndex(s => s.id === shift.id);
      if (idx >= 0) {
        updatedShifts[idx] = { ...updatedShifts[idx], ...updated };
      } else {
        updatedShifts.push({ ...shift, ...updated });
      }

      if (result.isForced) forced++;
      else assigned++;
    } else {
      empty++;
    }
  }

  progress(100, 'שיבוץ הושלם!');

  return {
    assigned,
    forced,
    empty,
    total: shiftsToAssign.length
  };
}
