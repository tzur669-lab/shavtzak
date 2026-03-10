// logic.js - אלגוריתם שיבוץ
// גרסה 3.0 — הכי ישן / יחס עומס

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
// מנוחה מינימלית לחייל — אישי דורס גלובלי
// ─────────────────────────────────────────────

function getMinRest(soldier, globalMinRest) {
  if (soldier.min_rest_minutes !== null &&
      soldier.min_rest_minutes !== undefined &&
      soldier.min_rest_minutes > 0) {
    return soldier.min_rest_minutes;
  }
  return globalMinRest;
}

// ─────────────────────────────────────────────
// שלב 1 — בניית משבצות ריקות
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
          post_id:             post.id,
          requirement_id:      req.id,
          soldier_id:          null,
          start_time:          cursor,
          end_time:            actualEnd,
          rest_before_minutes: null,
          is_forced:           false,
          is_locked:           false
        });
      }

      cursor = actualEnd;
      if (cursor >= endISO) break;
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// האם חייל תפוס בטווח זמן
// ─────────────────────────────────────────────

function isBusy(soldierId, start, end, allShifts) {
  return allShifts.some(s =>
    s.soldier_id === soldierId &&
    s.start_time < end &&
    s.end_time   > start
  );
}

// ─────────────────────────────────────────────
// משמרת אחרונה של חייל לפני זמן נתון
// ─────────────────────────────────────────────

function getLastShiftBefore(soldierId, beforeISO, allShifts) {
  const mine = allShifts.filter(s =>
    s.soldier_id === soldierId && s.end_time <= beforeISO
  );
  if (mine.length === 0) return null;
  return mine.reduce((latest, s) =>
    s.end_time > latest.end_time ? s : latest
  );
}

// ─────────────────────────────────────────────
// מצב א — "הכי ישן"
// ציון = כמה דקות עברו מסיום המשמרת האחרונה
// ציון גבוה יותר = לא שמר הרבה זמן = עדיפות גבוהה
// מי שלא שמר בכלל מקבל ציון MAX
// ─────────────────────────────────────────────

function scoreOldest(soldierId, shiftStart, allShifts) {
  const last = getLastShiftBefore(soldierId, shiftStart, allShifts);
  if (!last) return Number.MAX_SAFE_INTEGER; // לא שמר בכלל — עדיפות ראשונה
  return diffMinutes(last.end_time, shiftStart); // ציון = דקות מנוחה
}

// ─────────────────────────────────────────────
// מצב ב — "יחס עומס"
// ציון = 1 / (שמירה / מנוחה)
// כלומר — ציון גבוה = יחס שמירה/מנוחה נמוך = פחות עמוס = עדיפות גבוהה
// ─────────────────────────────────────────────

function scoreLoadRatio(soldierId, shiftStart, allShifts) {
  const myShifts = allShifts.filter(s =>
    s.soldier_id === soldierId && s.end_time <= shiftStart
  );

  // לא שמר בכלל — עדיפות ראשונה
  if (myShifts.length === 0) return Number.MAX_SAFE_INTEGER;

  // סך שעות שמירה
  const totalShiftMins = myShifts.reduce((sum, s) =>
    sum + diffMinutes(s.start_time, s.end_time), 0
  );

  if (totalShiftMins === 0) return Number.MAX_SAFE_INTEGER;

  // מנוחה = זמן כולל מאז המשמרת הראשונה שלו פחות זמן שמירה
  const firstShift = myShifts.reduce((earliest, s) =>
    s.start_time < earliest.start_time ? s : earliest
  );
  const totalSpanMins = diffMinutes(firstShift.start_time, shiftStart);
  const restMins = Math.max(totalSpanMins - totalShiftMins, 1);

  // יחס = שמירה / מנוחה — נמוך = פחות עמוס
  // ציון = הופכי של יחס = גבוה יותר אצל מי שפחות עמוס
  const ratio = totalShiftMins / restMins;
  return 1 / ratio;
}

// ─────────────────────────────────────────────
// שמירת חובש — האם לשמור מומחה לעמדות עתידיות
// ─────────────────────────────────────────────

function shouldReserveSpecialist(soldier, shift, posts, allShifts, soldiers) {
  if (!soldier.roles?.length) return false;

  const post = posts.find(p => p.id === shift.post_id);
  if (!post) return false;
  const req = post.requirements?.[shift.requirement_id];

  // אם העמדה הנוכחית כבר דורשת פק"ל — אין סיבה לשמור
  if (req?.required_role_id) return false;

  const windowEnd = addMinutes(shift.start_time, SPECIALIST_WINDOW_MINS);

  for (const roleId of soldier.roles) {
    // ספור כמה משמרות ריקות שדורשות את הפק"ל הזה בחלון הזמן
    let demandCount = 0;
    for (const p of posts) {
      const reqs = p.requirements ? Object.values(p.requirements) : [];
      for (const r of reqs) {
        if (r.required_role_id === roleId) {
          demandCount += allShifts.filter(s =>
            s.post_id    === p.id &&
            s.start_time >= shift.start_time &&
            s.start_time <  windowEnd &&
            !s.soldier_id
          ).length;
        }
      }
    }

    // ספור כמה חיילים מוסמכים פעילים יש
    const qualified = soldiers.filter(s =>
      s.is_active && s.roles?.includes(roleId)
    ).length;

    // אם הביקוש >= ההיצע — שמור את החייל
    if (qualified <= demandCount) return true;
  }

  return false;
}

// ─────────────────────────────────────────────
// בחירת החייל הטוב ביותר למשמרת
// ─────────────────────────────────────────────

function assignBestSoldier(shift, soldiers, posts, allShifts, options) {
  const { rankMode, shortageAction, globalMinRest } = options;

  // ── 1. סינון מועמדים תקינים ──────────────
  const candidates = soldiers.filter(s => {
    // לא פעיל
    if (!s.is_active) return false;

    // בחופשה / מחלה
    if (s.return_to_service_time &&
        new Date(s.return_to_service_time) > new Date(shift.start_time)) return false;

    // תפוס במשמרת מקבילה
    if (isBusy(s.id, shift.start_time, shift.end_time, allShifts)) return false;

    // בדיקת פק"ל נדרש
    const post = posts.find(p => p.id === shift.post_id);
    const req  = post?.requirements?.[shift.requirement_id];
    if (req?.required_role_id && !s.roles?.includes(req.required_role_id)) return false;

    return true;
  });

  if (candidates.length === 0) {
    return { soldierId: null, restMins: null, isForced: false };
  }

  // ── 2. הסרת מומחים שמורים ─────────────────
  const nonReserved = candidates.filter(s =>
    !shouldReserveSpecialist(s, shift, posts, allShifts, soldiers)
  );
  const pool = nonReserved.length > 0 ? nonReserved : candidates;

  // ── 3. חישוב ציון + בדיקת מנוחה ─────────
  const scored = pool.map(s => {
    const last     = getLastShiftBefore(s.id, shift.start_time, allShifts);
    const restMins = last ? Math.round(diffMinutes(last.end_time, shift.start_time)) : null;
    const minRest  = getMinRest(s, globalMinRest);

    const score = rankMode === 'oldest'
      ? scoreOldest(s.id, shift.start_time, allShifts)
      : scoreLoadRatio(s.id, shift.start_time, allShifts);

    const isLegal = restMins === null || restMins >= minRest;

    return { soldier: s, score, restMins, minRest, isLegal };
  });

  // מיון — ציון גבוה קודם
  scored.sort((a, b) => b.score - a.score);

  // ── 4. בחר מהמועמדים החוקיים ─────────────
  const legal = scored.filter(c => c.isLegal);

  if (legal.length > 0) {
    const best = legal[0];
    return {
      soldierId: best.soldier.id,
      restMins:  best.restMins,
      isForced:  false
    };
  }

  // ── 5. אם אין חוקי — כפייה או ריק ────────
  if (shortageAction === 'force' && scored.length > 0) {
    const best = scored[0];
    return {
      soldierId: best.soldier.id,
      restMins:  best.restMins,
      isForced:  true
    };
  }

  return { soldierId: null, restMins: null, isForced: false };
}

// ─────────────────────────────────────────────
// פונקציה ראשית — generateShifts
// ─────────────────────────────────────────────

export async function generateShifts(
  startISO,
  endISO,
  shortageAction   = 'empty',
  rankMode         = 'oldest',
  resetHistory     = false,
  runMode          = 'new',
  globalMinRest    = null,
  progressCallback = null
) {
  const progress = (pct, msg) => progressCallback?.(pct, msg);

  progress(0, 'טוען נתונים...');

  const [settings, posts, soldiers, allShifts] = await Promise.all([
    getSettings(), getPosts(), getSoldiers(), getShifts()
  ]);

  // גלובלי — מה שהמפקד הגדיר בדף שיבוץ, אחרת מהגדרות
  const effectiveGlobalMinRest = globalMinRest ?? settings.min_rest_minutes ?? 240;

  const options = { rankMode, shortageAction, globalMinRest: effectiveGlobalMinRest };

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

  // מיון כרונולוגי
  shiftsToAssign.sort((a, b) => a.start_time.localeCompare(b.start_time));

  // אם resetHistory — מתחיל חישוב מנוחה רק מתחילת הטווח
  const baseShifts = resetHistory
    ? allShifts.filter(s => s.start_time < startISO)
    : allShifts;

  let assigned = 0, forced = 0, empty = 0;

  // workingShifts — מתעדכן עם כל שיבוץ כדי שהשיבוץ הבא יתחשב בו
  const workingShifts = [...baseShifts];

  for (let i = 0; i < shiftsToAssign.length; i++) {
    const shift = shiftsToAssign[i];

    // דלג על משמרות נעולות עם חייל
    if (shift.is_locked && shift.soldier_id) {
      const existing = {
        ...shift,
        rest_before_minutes: (() => {
          const last = getLastShiftBefore(shift.soldier_id, shift.start_time, workingShifts);
          return last ? Math.round(diffMinutes(last.end_time, shift.start_time)) : null;
        })()
      };
      workingShifts.push(existing);
      assigned++;
      continue;
    }

    if (i % 5 === 0) {
      progress(
        30 + Math.floor((i / shiftsToAssign.length) * 65),
        `משבץ ${i + 1} מתוך ${shiftsToAssign.length}...`
      );
    }

    const result = assignBestSoldier(shift, soldiers, posts, workingShifts, options);

    if (result.soldierId) {
      const upd = {
        soldier_id:          result.soldierId,
        rest_before_minutes: result.restMins,
        is_forced:           result.isForced,
        updated_at:          nowISO()
      };
      await updateShift(shift.id, upd);

      // הוסף לרשימה העובדת כדי שהשיבוצים הבאים יתחשבו בו
      workingShifts.push({ ...shift, ...upd });

      result.isForced ? forced++ : assigned++;
    } else {
      empty++;
      // הוסף משמרת ריקה לרשימה (לא חוסמת אף אחד)
      workingShifts.push({ ...shift, soldier_id: null });
    }
  }

  progress(100, 'שיבוץ הושלם!');

  await logAction('generateShifts', {
    runMode, rankMode, assigned, forced, empty,
    startISO, endISO
  });

  return { assigned, forced, empty, total: shiftsToAssign.length };
}

// ─────────────────────────────────────────────
// משמרת חירום — מי זמין עכשיו
// ─────────────────────────────────────────────

export async function findEmergencySoldier(postId, requirementId) {
  const [soldiers, posts, allShifts, settings] = await Promise.all([
    getSoldiers(), getPosts(), getShifts(), getSettings()
  ]);

  const now     = nowISO();
  const post    = posts.find(p => p.id === postId);
  const req     = post?.requirements?.[requirementId];

  const candidates = soldiers.filter(s => {
    if (!s.is_active) return false;
    if (s.return_to_service_time &&
        new Date(s.return_to_service_time) > new Date()) return false;
    if (req?.required_role_id && !s.roles?.includes(req.required_role_id)) return false;
    return !isBusy(s.id, now, addMinutes(now, 1), allShifts);
  });

  const globalMinRest = settings.min_rest_minutes ?? 240;

  return candidates.map(s => {
    const last = getLastShiftBefore(s.id, now, allShifts);
    const restMins = last
      ? Math.round(diffMinutes(last.end_time, now))
      : 999999;
    const minRest  = getMinRest(s, globalMinRest);
    return { ...s, restMins, isLegal: restMins >= minRest };
  }).sort((a, b) => b.restMins - a.restMins);
}

// ─────────────────────────────────────────────
// בדיקת עומס
// ─────────────────────────────────────────────

export async function checkWorkload(startISO, endISO) {
  const [soldiers, shifts] = await Promise.all([
    getSoldiers(),
    getShiftsInRange(startISO, endISO)
  ]);

  const counts = {};
  soldiers.forEach(s => {
    counts[s.id] = { soldier: s, count: 0, forcedCount: 0, totalMins: 0 };
  });

  shifts.forEach(sh => {
    if (sh.soldier_id && counts[sh.soldier_id]) {
      counts[sh.soldier_id].count++;
      if (sh.is_forced) counts[sh.soldier_id].forcedCount++;
      counts[sh.soldier_id].totalMins +=
        diffMinutes(sh.start_time, sh.end_time);
    }
  });

  const results = Object.values(counts).filter(c => c.count > 0);
  const avg = results.length > 0
    ? results.reduce((s, c) => s + c.count, 0) / results.length
    : 0;

  results.forEach(c => {
    c.isOverloaded = avg > 0 && c.count > avg * 1.5;
  });

  return {
    results: results.sort((a, b) => b.count - a.count),
    avg
  };
}
