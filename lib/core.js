// Webhook, fon funksiyasi va rejalashtiruvchi uchun umumiy kod
import { Bot, InlineKeyboard } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { getStore } from "@netlify/blobs";
import QUIZ_LIST from "./quizzes.generated.js";

// ---------- sozlamalar ----------

export const TOKEN = process.env.BOT_TOKEN;
export const SECRET = process.env.WEBHOOK_SECRET;
export const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : null;
const DEFAULT_SITE = process.env.SITE_URL || "https://linguify-quiz-bot.netlify.app";
export const TZ_OFFSET_H = 5; // Toshkent (UTC+5)

let _site = DEFAULT_SITE;
export const setSiteUrl = (u) => {
  if (u) _site = u;
};
export const getSiteUrl = () => _site;

export const DEFAULT_TIME = 20;
export const TIME_CHOICES = [10, 15, 20, 30, 45, 60];
export const MIN_TIME = 5; // Telegram ruxsat bergan oraliq
export const MAX_TIME = 600;
export const MIN_PLAYERS_CHOICES = [1, 2, 3, 5, 10];
export const DEFAULT_MIN_PLAYERS = 2;
export const WAIT_CHOICES = [10, 30, 60, 120]; // yetarli odam yig'ilgach kutish (soniya)
export const DEFAULT_WAIT = 10;
export const GAP_CHOICES = [2, 5, 10, 15, 30]; // savollar orasidagi tanaffus (soniya)
export const DEFAULT_GAP = 2;
export const LOBBY_TIMEOUT_MS = 10 * 60 * 1000; // 10 daqiqada yetarli odam yig'ilmasa — bekor
export const LOW_SCORE_PCT = 60;

export const ACCESS_LABELS = {
  admins: "Faqat adminlar",
  all: "Barcha a'zolar",
  list: "Adminlar + tanlanganlar",
};

// kalit: [saqlanadigan nom, tugma matni, standart qiymat]
export const TOGGLES = {
  sq: ["shuffleQ", "Savollar aralashishi", true],
  so: ["shuffleO", "Variantlar aralashishi", true],
  pin: ["pin", "Reytingni qadash (pin)", true],
  cf: ["confirm", "Boshlashdan oldin tasdiq", true],
  rm: ["remind", "Past natijalilarga eslatma", true],
};

export const NO_ACCESS = "⛔ Sizda testni boshqarish huquqi yo'q. Guruh admini bot sozlamalarida sizga ruxsat berishi mumkin.";
export const ADMIN_ONLY = "Bu sozlamani faqat guruh adminlari o'zgartira oladi.";
export const DISABLED_TEXT = "🔴 Bu yerda testlar hozir o'chirilgan. Admin ularni bot sozlamalaridan yoqishi mumkin.";

export const quizzes = new Map(QUIZ_LIST.map((q) => [q.id, q]));

export const bot = new Bot(TOKEN || "BOT_TOKEN_YOQ");
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));

let _uname;
export async function botUsername() {
  if (!_uname) _uname = (await bot.api.getMe()).username;
  return _uname;
}

// ---------- Netlify Blobs xotirasi ----------
// chat/<chatId>        — chat sozlamalari va nomi
// quiz/<id>            — foydalanuvchi yaratgan testlar; uq/<userId>/<id> — ularning indeksi
// user/<userId>        — statistika, nishonlar, xato qilingan savollar
// sched/<id>           — rejalashtirilgan testlar; remind/<userId> — eslatmalar
// session/<chatId>     — ketayotgan test; stop|pause|start/<chatId>/<runId> — belgilar
// poll/<pollId>        — savol -> to'g'ri javob
// ans/<chatId>/<runId>/<userId>/<pollId>~<1|0>~<ms> — javoblar
// name/<chatId>/<runId>/<userId>  — ishtirokchi ismi
// ready/<chatId>/<runId>/<userId> — "Tayyorman" bosganlar
// await/*              — bot javob kutayotgan holatlar
// meta/*               — hisoblagichlar, xatolar jurnali

const store = () => getStore({ name: "quizbot", consistency: "strong" });

export const getJSON = async (key) => (await store().get(key, { type: "json" })) ?? null;
export const setJSON = (key, value) => store().setJSON(key, value);
export const getText = async (key) => (await store().get(key)) ?? null;
export const setText = (key, value) => store().set(key, value);
export const del = (key) => store().delete(key);

export async function listKeys(prefix) {
  const { blobs } = await store().list({ prefix });
  return blobs.map((b) => b.key);
}

export async function delPrefix(prefix) {
  const keys = await listKeys(prefix);
  for (let i = 0; i < keys.length; i += 50) await Promise.all(keys.slice(i, i + 50).map(del));
}

// ---------- vaqt ----------

/** Toshkent bo'yicha sana: "2026-11-25" */
export const tashDay = (ts = Date.now()) => new Date(ts + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);

// ---------- chat sozlamalari ----------

export const getChat = async (id) => (await getJSON(`chat/${id}`)) ?? {};

export async function updateChat(id, patch) {
  const next = { ...(await getChat(id)), ...patch };
  await setJSON(`chat/${id}`, next);
  return next;
}

export const timeOf = (s) => s.time ?? DEFAULT_TIME;
export const gapOf = (s) => s.gap ?? DEFAULT_GAP;
export const lobbyWaitOf = (s) => s.wait ?? DEFAULT_WAIT;
export const accessOf = (s) => s.access ?? "admins";
export const managersOf = (s) => s.managers ?? {};
export const enabledOf = (s) => s.enabled !== false;
export const minPlayersOf = (s) => s.minPlayers ?? DEFAULT_MIN_PLAYERS;
export const toggleOf = (s, key) => s[TOGGLES[key][0]] ?? TOGGLES[key][2];
export const isGroupType = (type) => type === "group" || type === "supergroup";

export async function rememberChat(chat) {
  const s = await getChat(chat.id);
  if (s.title !== chat.title || s.type !== chat.type || s.left) {
    await updateChat(chat.id, { title: chat.title, type: chat.type, left: false });
  }
}

/** Sozlanayotgan chat (shaxsiy chatdan guruhni sozlaganda ham) */
export async function targetChat(id) {
  const s = await getChat(id);
  return { chat: { id: Number(id), type: s.type ?? "private", title: s.title }, s };
}

// ---------- yordamchilar ----------

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const userName = (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || String(u.user_id ?? u.id);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1).trimEnd() + "…" : String(s));

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function fmtTime(s) {
  if (s < 60) return `${s} soniya`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} daqiqa ${r} soniya` : `${m} daqiqa`;
}

export function fmtDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

/** "25", "25s", "2m", "1m30s" -> soniya */
export function parseTime(str) {
  const s = str.trim().toLowerCase().replace(/\s+/g, "");
  let m;
  if ((m = s.match(/^(\d+)(s|sek|soniya)?$/))) return Number(m[1]);
  if ((m = s.match(/^(\d+)(m|min|daqiqa)(?:(\d+)(s|sek|soniya)?)?$/))) return Number(m[1]) * 60 + Number(m[3] ?? 0);
  return null;
}

export const validTime = (t) => t !== null && t >= MIN_TIME && t <= MAX_TIME;

/** Foydalanuvchiga shaxsiy xabar (botni /start qilmagan bo'lsa — false) */
export async function dm(userId, text, extra = {}) {
  try {
    await bot.api.sendMessage(userId, text, { parse_mode: "HTML", ...extra });
    return true;
  } catch {
    return false;
  }
}

// ---------- testlar ----------

export async function getQuiz(id) {
  const b = quizzes.get(id);
  if (b) return { ...b, builtin: true };
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) return null;
  return await getJSON(`quiz/${id}`);
}

// ---------- huquqlar ----------

export async function isAdmin(chat, user, senderChat) {
  if (chat.type === "private") return !user || chat.id === user.id;
  if (senderChat && senderChat.id === chat.id) return true; // anonim admin
  if (!user) return chat.type === "channel"; // kanalga faqat adminlar post yoza oladi
  try {
    const member = await bot.api.getChatMember(chat.id, user.id);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

/** Testni boshlash/to'xtatish va vaqtni o'zgartirish huquqi */
export async function canManage(chat, user, senderChat) {
  if (await isAdmin(chat, user, senderChat)) return true;
  if (!user || !isGroupType(chat.type)) return false;
  const s = await getChat(chat.id);
  const access = accessOf(s);
  if (access === "all") return true;
  if (access === "list") return Boolean(managersOf(s)[user.id]);
  return false;
}

// ---------- sozlamalar paneli (guruhda ham, shaxsiy chatda ham) ----------

export function settingsPanel(target, s, viewerType, schedCount = 0) {
  const p = `s:${target.id}`;
  const t = timeOf(s);
  const kb = new InlineKeyboard();
  const group = isGroupType(target.type);
  let text;

  if (target.type === "private") {
    text = "⚙️ <b>Sozlamalar</b> (shu shaxsiy chat uchun)\n\n";
  } else {
    const enabled = enabledOf(s);
    text =
      `⚙️ <b>Sozlamalar</b>\n${target.type === "channel" ? "📢" : "👥"} <b>${esc(target.title ?? "Guruh")}</b>\n\n` +
      `🔘 Testlar: <b>${enabled ? "🟢 yoqilgan" : "🔴 o'chirilgan"}</b>\n`;
    kb.text(enabled ? "🟢 Testlar yoqilgan — o'chirish" : "🔴 Testlar o'chirilgan — yoqish", `${p}:en`).row();
  }
  text += `⏱ Har bir savolga vaqt: <b>${fmtTime(t)}</b>\n⏸ Savollar orasida: <b>${gapOf(s)} soniya</b>\n`;

  kb.text("— ⏱ Savol vaqti —", "noop").row();
  TIME_CHOICES.forEach((sec, i) => {
    kb.text(`${t === sec ? "✅ " : ""}${sec} soniya`, `${p}:t:${sec}`);
    if (i % 3 === 2) kb.row();
  });
  kb.text(!TIME_CHOICES.includes(t) ? `✅ ✏️ O'z vaqtim: ${fmtTime(t)}` : "✏️ O'z vaqtimni yozaman", `${p}:tc`).row();

  kb.text("— ⏸ Savollar orasidagi tanaffus —", "noop").row();
  for (const g of GAP_CHOICES) kb.text(`${gapOf(s) === g ? "✅ " : ""}${g} s`, `${p}:gp:${g}`);
  kb.row();

  kb.text("— ⚙️ Qo'shimcha —", "noop").row();
  for (const k of group ? ["sq", "so", "pin", "cf", "rm"] : ["sq", "so"]) {
    kb.text(`${toggleOf(s, k) ? "✅" : "⬜️"} ${TOGGLES[k][1]}`, `${p}:tg:${k}`).row();
  }

  if (group) {
    const minP = minPlayersOf(s);
    text += `👥 Boshlash uchun kamida: <b>${minP} kishi</b>\n⏳ Yetarli odam yig'ilgach kutish: <b>${lobbyWaitOf(s)} soniya</b>\n`;
    kb.text("— 👥 Kamida necha kishi tayyor bo'lsin —", "noop").row();
    for (const n of MIN_PLAYERS_CHOICES) kb.text(`${minP === n ? "✅ " : ""}${n}`, `${p}:mp:${n}`);
    kb.row();
    kb.text("— ⏳ Yetarli odam yig'ilgach kutish —", "noop").row();
    for (const w of WAIT_CHOICES) kb.text(`${lobbyWaitOf(s) === w ? "✅ " : ""}${fmtTime(w)}`, `${p}:wt:${w}`);
    kb.row();

    const access = accessOf(s);
    const managers = Object.entries(managersOf(s));
    text += `👤 Testni kim boshqaradi: <b>${ACCESS_LABELS[access]}</b>\n`;
    if (access === "list") {
      text += managers.length
        ? `✅ Tanlanganlar: ${managers.map(([, name]) => esc(name)).join(", ")}\n`
        : "Hali hech kim tanlanmagan — ➕ tugmasi orqali qo'shing.\n";
    }
    text +=
      "\n<i>Boshqarish — testni boshlash, to'xtatish, pauza va vaqtni o'zgartirish. " +
      "Testlarni yoqish/o'chirish va kim boshqarishini faqat adminlar tanlaydi. " +
      "Savollarga esa guruhdagi hamma javob bera oladi.</i>";

    kb.text("— 👤 Kim boshqaradi —", "noop").row();
    for (const [key, label] of Object.entries(ACCESS_LABELS)) kb.text(`${access === key ? "✅ " : ""}${label}`, `${p}:a:${key}`).row();
    if (access === "list") {
      for (const [uid, name] of managers) kb.text(`❌ ${name}`, `${p}:md:${uid}`).row();
      kb.text("➕ Odam qo'shish", `${p}:ma`).row();
    }
    kb.text(`⏰ Rejalashtirilgan testlar${schedCount ? ` (${schedCount})` : ""}`, `sc:${target.id}`).row();
  } else {
    text += `\n<i>Tayyor variantni tanlang yoki "O'z vaqtim" orqali ${MIN_TIME}–${MAX_TIME} soniya yozing. Tezkor: /time 25</i>`;
  }

  if (viewerType === "private") kb.text(target.type === "private" ? "👥 Mening guruhlarim" : "⬅️ Guruhlar ro'yxati", "glist");
  return { text, kb };
}

// ---------- kutish xonasi (lobby) ----------

export function lobbyText({ title, description, total, time, min, cd, names, countdown }) {
  let text =
    `🎯 <b>${esc(title)}</b>\n` +
    (description ? `${esc(description)}\n` : "") +
    `\n📝 ${total} ta savol · ⏱ har biriga ${fmtTime(time)}\n` +
    `👥 Boshlash uchun kamida <b>${min}</b> kishi kerak\n\n` +
    `✋ <b>Tayyor (${names.length}/${min}):</b>\n` +
    (names.length ? names.map((n, i) => `${i + 1}. ${esc(n)}`).join("\n") : "<i>hali hech kim yo'q</i>");
  text += countdown
    ? `\n\n🚀 Yetarli odam yig'ildi! <b>${fmtTime(cd)} ichida boshlanadi</b> — hali qo'shilishingiz mumkin.`
    : `\n\nQatnashish uchun pastdagi <b>✋ Men tayyorman</b> tugmasini bosing.`;
  return text;
}

export const lobbyKeyboard = () =>
  new InlineKeyboard().text("✋ Men tayyorman", "lobby:join").row().text("▶️ Hozir boshlash", "lobby:now").text("❌ Bekor qilish", "lobby:cancel");

// ---------- testlar sessiyasi ----------

export const getSession = (chatId) => getJSON(`session/${chatId}`);
export const stopRequested = async (chatId, runId) => (await getText(`stop/${chatId}/${runId}`)) !== null;
export const requestStop = (chatId, runId) => setText(`stop/${chatId}/${runId}`, "1");

/** Runner uzoq vaqt "yurak urishi" bermasa — sessiya osilib qolgan deb hisoblanadi */
export const isStale = (session) => Date.now() - (session.heartbeat ?? 0) > ((session.time ?? DEFAULT_TIME) + 120) * 1000;

export async function readyNames(chatId, runId) {
  const keys = await listKeys(`ready/${chatId}/${runId}/`);
  const names = await Promise.all(keys.map((k) => getText(k)));
  return names.filter(Boolean);
}

export async function invokeRunner(payload) {
  const res = await fetch(`${getSiteUrl()}/.netlify/functions/quiz-runner-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-runner-secret": SECRET },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Runner ishga tushmadi: ${res.status}`);
}

/**
 * Testni boshlaydi: guruhda — (tasdiq) + kutish xonasi, boshqa joyda — darhol.
 * opts: { startedBy, skipConfirm, custom (tayyor test obyekti), kind }
 */
export async function startQuiz(chat, quizId, opts = {}) {
  const quiz = opts.custom ?? (await getQuiz(quizId));
  if (!quiz) return bot.api.sendMessage(chat.id, `"${quizId}" degan test topilmadi. Ro'yxat: /quiz`);

  const s = await getChat(chat.id);
  if (!enabledOf(s)) return bot.api.sendMessage(chat.id, DISABLED_TEXT);

  const existing = await getSession(chat.id);
  if (existing && !isStale(existing)) {
    return bot.api.sendMessage(chat.id, "Bu yerda test allaqachon ketyapti. To'xtatish uchun: /stop");
  }

  if (isGroupType(chat.type) && toggleOf(s, "cf") && !opts.skipConfirm) {
    return bot.api.sendMessage(
      chat.id,
      `🎯 <b>${esc(quiz.title)}</b>\n📝 ${quiz.questions.length} ta savol · ⏱ har biriga ${fmtTime(timeOf(s))}\n\nTestni boshlaymizmi?`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("✅ Ha, boshlash", `cf:y:${quiz.id}`).text("❌ Yo'q", "cf:n") },
    );
  }

  let qs = quiz.questions.map((q, i) => ({
    question: q.question,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation ?? null,
    key: q.key ?? `${quiz.id}:${i}`,
  }));
  if (toggleOf(s, "sq")) qs = shuffle(qs);

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const session = {
    runId,
    quizId: quiz.id,
    title: quiz.title,
    description: quiz.description ?? "",
    kind: opts.kind ?? "quiz",
    chatType: chat.type,
    anonymous: chat.type === "channel",
    time: timeOf(s),
    gap: gapOf(s),
    cd: lobbyWaitOf(s),
    pin: toggleOf(s, "pin"),
    shuffleO: toggleOf(s, "so"),
    remind: toggleOf(s, "rm"),
    min: minPlayersOf(s),
    phase: isGroupType(chat.type) ? "lobby" : "intro",
    startedAt: Date.now(),
    heartbeat: Date.now(),
    startedBy: opts.startedBy ?? null,
    questions: qs,
    total: qs.length,
    pollQ: {},
    polls: [],
  };

  if (session.phase === "lobby") {
    const msg = await bot.api.sendMessage(chat.id, lobbyText({ ...session, names: [], countdown: false }), {
      parse_mode: "HTML",
      reply_markup: lobbyKeyboard(),
    });
    session.lobbyMsgId = msg.message_id;
  }

  await setJSON(`session/${chat.id}`, session);
  try {
    await invokeRunner({ chatId: chat.id, runId, index: 0 });
  } catch (e) {
    console.error(e);
    await del(`session/${chat.id}`);
    await bot.api.sendMessage(chat.id, "⚠️ Testni ishga tushirib bo'lmadi. Birozdan keyin qayta urinib ko'ring.");
  }
}

/**
 * Testni to'xtatish so'rovi (runner buni 2 soniya ichida ko'radi va o'zi xabar yozadi).
 * Natija: false — test yo'q; "requested" — runnerga aytildi; "cleared" — osilib qolgan test tozalandi
 */
export async function stopQuiz(chatId) {
  const session = await getSession(chatId);
  if (!session) return false;
  if (isStale(session)) {
    await del(`session/${chatId}`);
    return "cleared";
  }
  await requestStop(chatId, session.runId);
  return "requested";
}
