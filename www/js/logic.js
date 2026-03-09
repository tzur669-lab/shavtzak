// logic.js - אלגוריתם שיבוץ
// גרסה 2.0 — כולל נעילת משמרת, משמרת חירום, בדיקת עומס

import {
  getSettings, getPosts, getSoldiers, getShifts,
  getShiftsInRange, deleteShiftsInRange, clearSoldiersInRange,
  saveShiftsBatch, updateShift, logAction
} from './firebase.js';

// ─────────────────────────────────────────────
// קבועים
// ─────────────────────────────────────────────

const MIN_SHIFT_MINUTES      = 30;
const SPECIALIST_WINDOW_MINS = 240;

// ─────────────────────────────────────────────
// כלי זמן
// ─────────────────────────────────────────────

function diffMinutes(isoA, isoB) {
  return (new Date(isoB) - new Date(isoA)) / 60000;
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

function nowISO() { return new Date().toISOString(); }

// ─────────────────────────────────────────────
// שלב 1 — יצירת משבצות ריקות
// ─────────────────────────────────────────────

function buildEmptyShifts(posts, startISO, endISO) {
  const result = [];

  for (const post of posts) {
    const reqs = post.requirements
      ? Object.entries(post.requirements).map(([id, d]) => ({ id, ...d }))
      : [];
    if (reqs.length === 0) continue;

    const durMins = Math.max(post.duration_minutes || 60, MIN_SHIFT_MINUTES);
    let cursor = startISO;

    while (cursor < endISO) {
      const rawEnd    = addMinutes(cursor, durMins);
      const actualEnd = rawEnd > endISO ? endISO : rawEnd;
      if (diffMinutes(cursor, actualEnd) < MIN_SHIFT_MINUTES) break;

      for (const req of reqs) {
        result.push({
          post_id: post.id,
          requirement_id: req.id,
          soldier_id: null,
          start_time: cursor,
          end_time: actualEnd,
          rest_before_minutes: null,
          is_forced: false,
          is_locked: false
        });
      }

      cursor = actualEnd;
      if (cursor >= endISO) break;
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// שלב 3 — אלגוריתם שיבוץ
// ─────────────────────────────────────────────

function isBusy(soldier, start, end, allShifts) {
  return allShifts.some(s =>
    s.soldier_id === soldier.id &&
    s.start_time < end && s.end_time > start
  );
}

function getLastShiftBefore(soldierId, beforeISO, allShifts) {
  return allShifts
    .filter(s => s.soldier_id === soldierId && s.end_time <= beforeISO)
    .sort((a, b) => b.end_time.localeCompare(a.end_time))[0] || null;
}

function calcScore(soldier, shift, allShifts, restCalc, resetHistory) {
  const last = getLastShiftBefore(soldier.id, shift.start_time, allShifts);
  if (!last) return 999999;
  if (resetHistory && last.start_time < shift.start_time) return 999999;

  const restMins = diffMinutes(last.end_time, shift.start_time);
  if (restCalc === 'relative') {
    const lastDur = diffMinutes(last.start_time, last.end_time);
    return lastDur > 0 ? restMins / lastDur : restMins;
  }
  return restMins;
}

function shouldReserveSpecialist(soldier, shift, posts, allShifts, soldiers) {
  if (!soldier.roles?.length) return false;
  const post = posts.find(p => p.id === shift.post_id);
  if (!post) return false;
  const req = post.requirements?.[shift.requirement_id];
  if (req?.required_role_id) return false;

  const windowEnd = addMinutes(shift.start_time, SPECIALIST_WINDOW_MINS);

  for (const roleId of soldier.roles) {
    let demandCount = 0;
    for (const p of posts) {
      const reqs = p.requirements ? Object.values(p.requirements) : [];
      for (const r of reqs) {
        if (r.required_role_id === roleId) {
          const count = allShifts.filter(s =>
            s.post_id === p.id &&
            s.start_time >= shift.start_time &&
            s.start_time < windowEnd &&
            s.soldier_id === null
          ).length;
          demandCount += count;
        }
      }
    }
    const qualified = soldiers.filter(s => s.is_active && s.roles?.includes(roleId)).length;
    if (qualified <= demandCount) return true;
  }
  return false;
}

function assignBestSoldier(shift, soldiers, posts, allShifts, options) {
  const { restCalc, resetHistory, shortageAction, minRestMinutes } = options;

  // סינון מועמדים
  const candidates = soldiers.filter(s => {
    if (!s.is_active) return false;
    if (s.return_to_service_time && new Date(s.return_to_service_time) > new Date(shift.start_time)) return false;
    if (isBusy(s, shift.start_time, shift.end_time, allShifts)) return false;
    const post = posts.find(p => p.id === shift.post_id);
    const req  = post?.requirements?.[shift.requirement_id];
    if (req?.required_role_id && !s.roles?.includes(req.required_role_id)) return false;
    return true;
  });

  if (candidates.length === 0) return { soldierId: null, restMins: null, isForced: false };

  // הסרת חובשים שמורים
  const nonReserved = candidates.filter(s =>
    !shouldReserveSpecialist(s, shift, posts, allShifts, soldiers)
  );
  const pool = nonReserved.length > 0 ? nonReserved : candidates;

  // חישוב ציונים
  const scored = pool.map(s => {
    const last = getLastShiftBefore(s.id, shift.start_time, allShifts);
    return {
      soldier: s,
      score: calcScore(s, shift, allShifts, restCalc, resetHistory),
      restMins: last ? diffMinutes(last.end_time, shift.start_time) : null
    };
  }).sort((a, b) => b.score - a.score);

  const legal = scored.filter(c =>
    c.score === 999999 || (c.restMins !== null && c.restMins >= minRestMinutes)
  );

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
// פונקציה ראשית
// ─────────────────────────────────────────────

export async function generateShifts(
  startISO, endISO,
  shortageAction = 'empty',
  restCalc = 'regular',
  resetHistory = false,
  runMode = 'new',
  progressCallback = null
) {
  const progress = (pct, msg) => progressCallback?.(pct, msg);

  progress(0, 'טוען נתונים...');

  const [settings, posts, soldiers, allShifts] = await Promise.all([
    getSettings(), getPosts(), getSoldiers(), getShifts()
  ]);

  const minRestMinutes = settings.min_rest_minutes ?? 240;
  const options = { shortageAction, restCalc, resetHistory, minRestMinutes };

  progress(10, 'מכין משמרות...');

  let shiftsToAssign = [];

  if (runMode === 'new') {
    progress(15, 'מוחק משמרות קיימות...');
    await deleteShiftsInRange(startISO, endISO);

    const empty = buildEmptyShifts(posts, startISO, endISO);
    progress(25, `נוצרו ${empty.length} משמרות. שומר...`);
    await saveShiftsBatch(empty);
    shiftsToAssign = await getShiftsInRange(startISO, endISO);

  } else if (runMode === 'reassign') {
    progress(15, 'מרוקן שיבוצים...');
    await clearSoldiersInRange(startISO, endISO);
    shiftsToAssign = await getShiftsInRange(startISO, endISO);

  } else if (runMode === 'holes') {
    const inRange = await getShiftsInRange(startISO, endISO);
    shiftsToAssign = inRange.filter(s => !s.soldier_id && !s.is_locked);
  }

  progress(30, `משבץ ${shiftsToAssign.length} משמרות...`);
  shiftsToAssign.sort((a, b) => a.start_time.localeCompare(b.start_time));

  let assigned = 0, forced = 0, empty = 0;
  const workingShifts = [...allShifts];

  for (let i = 0; i < shiftsToAssign.length; i++) {
    const shift = shiftsToAssign[i];

    // דלג על משמרות נעולות
    if (shift.is_locked && shift.soldier_id) {
      assigned++;
      continue;
    }

    if (i % 5 === 0) progress(30 + Math.floor((i / shiftsToAssign.length) * 65), `משבץ ${i+1} מתוך ${shiftsToAssign.length}...`);

    const result = assignBestSoldier(shift, soldiers, posts, workingShifts, options);

    if (result.soldierId) {
      const upd = {
        soldier_id: result.soldierId,
        rest_before_minutes: result.restMins,
        is_forced: result.isForced,
        updated_at: nowISO()
      };
      await updateShift(shift.id, upd);

      const idx = workingShifts.findIndex(s => s.id === shift.id);
      if (idx >= 0) Object.assign(workingShifts[idx], upd);
      else workingShifts.push({ ...shift, ...upd });

      result.isForced ? forced++ : assigned++;
    } else {
      empty++;
    }
  }

  progress(100, 'שיבוץ הושלם!');
  await logAction('generateShifts', { runMode, assigned, forced, empty, startISO, endISO });

  return { assigned, forced, empty, total: shiftsToAssign.length };
}

// ─────────────────────────────────────────────
// משמרת חירום — מציאת החייל הזמין הכי מנוח עכשיו
// ─────────────────────────────────────────────

export async function findEmergencySoldier(postId, requirementId) {
  const [soldiers, posts, allShifts, settings] = await Promise.all([
    getSoldiers(), getPosts(), getShifts(), getSettings()
  ]);

  const now = nowISO();
  const minRest = settings.min_rest_minutes ?? 240;
  const post = posts.find(p => p.id === postId);
  const req  = post?.requirements?.[requirementId];

  const candidates = soldiers.filter(s => {
    if (!s.is_active) return false;
    if (s.return_to_service_time && new Date(s.return_to_service_time) > new Date()) return false;
    if (req?.required_role_id && !s.roles?.includes(req.required_role_id)) return false;
    // בדיקת עיסוק כרגע
    return !allShifts.some(sh =>
      sh.soldier_id === s.id &&
      sh.start_time <= now && sh.end_time > now
    );
  });

  // מיון לפי מנוחה מהגדולה לקטנה
  return candidates.map(s => {
    const last = allShifts
      .filter(sh => sh.soldier_id === s.id && sh.end_time <= now)
      .sort((a, b) => b.end_time.localeCompare(a.end_time))[0];
    const restMins = last ? diffMinutes(last.end_time, now) : 999999;
    return { ...s, restMins, isLegal: restMins >= minRest };
  }).sort((a, b) => b.restMins - a.restMins);
}

// ─────────────────────────────────────────────
// בדיקת עומס — מי קיבל הכי הרבה משמרות
// ─────────────────────────────────────────────

export async function checkWorkload(startISO, endISO) {
  const [soldiers, shifts] = await Promise.all([getSoldiers(), getShiftsInRange(startISO, endISO)]);

  const counts = {};
  soldiers.forEach(s => { counts[s.id] = { soldier: s, count: 0, forcedCount: 0, totalMins: 0 }; });

  shifts.forEach(sh => {
    if (sh.soldier_id && counts[sh.soldier_id]) {
      counts[sh.soldier_id].count++;
      if (sh.is_forced) counts[sh.soldier_id].forcedCount++;
      counts[sh.soldier_id].totalMins += diffMinutes(sh.start_time, sh.end_time);
    }
  });

  const results = Object.values(counts).filter(c => c.count > 0);
  const avg = results.length > 0
    ? results.reduce((s, c) => s + c.count, 0) / results.length
    : 0;

  // סימון עומס חריג — מעל 50% מהממוצע
  results.forEach(c => { c.isOverloaded = avg > 0 && c.count > avg * 1.5; });

  return { results: results.sort((a,b) => b.count - a.count), avg };
}
