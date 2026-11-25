// Foydalanuvchi statistikasi: ballar, seriya (streak), nishonlar, xato qilingan savollar
import { getJSON, setJSON, tashDay, esc, trunc } from "./core.js";

const MAX_WRONG = 60; // saqlanadigan xato savollar soni
const MAX_HISTORY = 10;

const dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);

export const BADGES = [
  { id: "first", label: "🎉 Birinchi test", ok: (u) => u.tests >= 1 },
  { id: "t5", label: "🔥 5 ta test", ok: (u) => u.tests >= 5 },
  { id: "t25", label: "💪 25 ta test", ok: (u) => u.tests >= 25 },
  { id: "t100", label: "🏆 100 ta test", ok: (u) => u.tests >= 100 },
  { id: "perfect", label: "💯 Mukammal natija", ok: (u, i) => i.kind === "quiz" && i.pct === 100 && i.total >= 5 },
  { id: "win", label: "🥇 G'olib", ok: (u) => u.wins >= 1 },
  { id: "win5", label: "👑 5 marta g'olib", ok: (u) => u.wins >= 5 },
  { id: "s3", label: "📅 3 kunlik seriya", ok: (u) => u.best >= 3 },
  { id: "s7", label: "📆 7 kunlik seriya", ok: (u) => u.best >= 7 },
  { id: "s30", label: "🗓 30 kunlik seriya", ok: (u) => u.best >= 30 },
  { id: "c100", label: "🎯 100 ta to'g'ri javob", ok: (u) => u.correct >= 100 },
  { id: "c500", label: "🚀 500 ta to'g'ri javob", ok: (u) => u.correct >= 500 },
  { id: "fix", label: "🧠 Xatolarni tuzatuvchi", ok: (u) => (u.fixedTotal ?? 0) >= 20 },
];
const badgeLabel = (id) => BADGES.find((b) => b.id === id)?.label ?? id;

export async function getUser(id) {
  return (
    (await getJSON(`user/${id}`)) ?? {
      id: Number(id), name: "", tests: 0, correct: 0, total: 0, streak: 0, best: 0, lastDay: null,
      wins: 0, fixedTotal: 0, badges: [], history: [], wrong: [], firstSeen: Date.now(),
    }
  );
}

/**
 * Test tugagach foydalanuvchi ma'lumotlarini yangilaydi.
 * info: { kind, title, correct, total, pct, rank, players, wrong: [{key, q}], fixed: [key] }
 * Qaytaradi: { u, newBadges: [matn] }
 */
export async function updateUserAfterSession(uid, name, info) {
  const u = await getUser(uid);
  const today = tashDay();
  if (name) u.name = name;

  if (u.lastDay !== today) {
    u.streak = u.lastDay && dayNum(today) - dayNum(u.lastDay) === 1 ? u.streak + 1 : 1;
    u.lastDay = today;
  }
  u.best = Math.max(u.best, u.streak);

  if (info.kind !== "mistakes") {
    u.tests += 1;
    u.correct += info.correct;
    u.total += info.total;
    if (info.rank === 1 && info.players >= 2) u.wins += 1;
    u.history = [...u.history, { t: info.title, c: info.correct, n: info.total, d: today }].slice(-MAX_HISTORY);
  }

  const fixed = new Set(info.fixed ?? []);
  const before = u.wrong.length;
  u.wrong = u.wrong.filter((w) => !fixed.has(w.key));
  if (info.kind === "mistakes") u.fixedTotal = (u.fixedTotal ?? 0) + (before - u.wrong.length);
  for (const w of info.wrong ?? []) {
    if (!u.wrong.some((x) => x.key === w.key)) u.wrong.push({ key: w.key, q: w.q });
  }
  u.wrong = u.wrong.slice(-MAX_WRONG);

  const newBadges = [];
  for (const b of BADGES) {
    if (!u.badges.includes(b.id) && b.ok(u, info)) {
      u.badges.push(b.id);
      newBadges.push(b.label);
    }
  }
  await setJSON(`user/${uid}`, u);
  return { u, newBadges };
}

/** /mystats matni */
export function statsText(u) {
  const pct = u.total ? Math.round((u.correct / u.total) * 100) : 0;
  const today = tashDay();
  const streakActive = u.lastDay && dayNum(today) - dayNum(u.lastDay) <= 1;
  let t = `📈 <b>Mening statistikam</b>${u.name ? ` — ${esc(u.name)}` : ""}\n\n`;
  t += `🧪 Testlar: <b>${u.tests}</b>\n`;
  t += `✅ To'g'ri javoblar: <b>${u.correct}/${u.total}</b> (${pct}%)\n`;
  t += `🔥 Seriya: <b>${streakActive ? u.streak : 0} kun</b> · eng yaxshi: ${u.best} kun\n`;
  t += `🥇 G'olib bo'lgan: <b>${u.wins}</b> marta\n`;
  t += `❌ Xatolar ro'yxatida: <b>${u.wrong.length}</b> ta savol\n`;
  t += `\n🏅 <b>Nishonlar</b> (${u.badges.length}/${BADGES.length}):\n`;
  t += u.badges.length ? u.badges.map((id) => `• ${badgeLabel(id)}`).join("\n") : "<i>hali yo'q — test yeching!</i>";
  if (u.history.length) {
    t += `\n\n🕘 <b>So'nggi natijalar</b>:\n`;
    t += [...u.history]
      .reverse()
      .slice(0, 5)
      .map((h) => `• ${esc(trunc(h.t, 40))} — ${h.c}/${h.n} (${Math.round((h.c / h.n) * 100)}%) · ${h.d}`)
      .join("\n");
  }
  return t;
}
