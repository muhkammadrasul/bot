// Rejalashtirilgan testlar (interfeys + ishga tushirish) va eslatmalar
import { InlineKeyboard } from "grammy";
import {
  bot, quizzes, getJSON, setJSON, del, listKeys, getChat, targetChat, isAdmin, esc, trunc, dm, startQuiz, getQuiz,
  ADMIN_ONLY, TZ_OFFSET_H, tashDay,
} from "./core.js";
import { getUser } from "./stats.js";
import { reportError } from "./admin.js";

const MAX_SCHEDULES_PER_CHAT = 10;
// JS getUTCDay(): 0=Yak, 1=Du ... 6=Sha. Ko'rsatish tartibi: Du...Yak
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = { 1: "Du", 2: "Se", 3: "Chor", 4: "Pay", 5: "Ju", 6: "Sha", 0: "Yak" };

const stateKey = (uid) => `await/sched/${uid}`;
const fmtDays = (days) => (days.length === 7 ? "Har kuni" : DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_NAMES[d]).join(", "));

// ---------- sof mantiq (testlash oson) ----------

/** Rejalashtirilgan test hozir ishga tushishi kerakmi? (Toshkent vaqti bo'yicha, 15 daqiqalik oyna) */
export function isDue(sched, now = Date.now()) {
  const t = new Date(now + TZ_OFFSET_H * 3600e3);
  if (!sched.days.includes(t.getUTCDay())) return false;
  if (sched.lastRun === tashDay(now)) return false;
  const [h, m] = sched.time.split(":").map(Number);
  const diff = t.getUTCHours() * 60 + t.getUTCMinutes() - (h * 60 + m);
  return diff >= 0 && diff < 15;
}

export const parseClock = (text) => {
  const m = text.trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
};

async function chatSchedules(chatId) {
  const keys = await listKeys("sched/");
  const all = await Promise.all(keys.map((k) => getJSON(k)));
  return all.filter((x) => x && x.chatId === Number(chatId));
}

export async function countSchedules(chatId) {
  return (await chatSchedules(chatId)).length;
}

// ---------- ishga tushirish (scheduler funksiyasi chaqiradi) ----------

export async function runScheduled(now = Date.now()) {
  let started = 0;
  for (const key of await listKeys("sched/")) {
    const s = await getJSON(key);
    if (!s || !isDue(s, now)) continue;
    s.lastRun = tashDay(now);
    await setJSON(key, s);
    try {
      const c = await getChat(s.chatId);
      if (c.left) continue;
      await startQuiz({ id: s.chatId, type: c.type ?? "supergroup", title: c.title }, s.quizId, { startedBy: s.createdBy, skipConfirm: true });
      started++;
    } catch (e) {
      await reportError("scheduler", e, `sched ${s.id}`);
    }
  }
  return started;
}

/** Past natija olganlarga ertasi kuni eslatma */
export async function runReminders(now = Date.now()) {
  let sent = 0;
  for (const key of await listKeys("remind/")) {
    const r = await getJSON(key);
    if (!r || r.due > now) continue;
    await del(key);
    const uid = key.split("/")[1];
    try {
      const u = await getUser(uid);
      if (!u.wrong.length) continue;
      const kb = new InlineKeyboard().text(`🔁 Xatolar ustida ishlash (${Math.min(u.wrong.length, 10)})`, "mx");
      const ok = await dm(
        uid,
        `🔔 <b>Eslatma</b>\n\nKecha «${esc(trunc(r.title ?? "test", 40))}» natijangiz past edi. Ro'yxatingizda <b>${u.wrong.length}</b> ta xato savol bor.\n` +
          `Bir necha daqiqa mashq qilsangiz, ular o'zlashadi 💪`,
        { reply_markup: kb },
      );
      if (ok) sent++;
    } catch (e) {
      await reportError("reminder", e, `user ${uid}`);
    }
  }
  return sent;
}

// ---------- interfeys ----------

async function showList(ctx, chatId, edit) {
  const { chat } = await targetChat(chatId);
  const list = (await chatSchedules(chatId)).sort((a, b) => a.time.localeCompare(b.time));
  const kb = new InlineKeyboard();
  let text = `⏰ <b>Rejalashtirilgan testlar</b>\n👥 ${esc(chat.title ?? "Guruh")}\n\n`;
  if (list.length) {
    const titles = await Promise.all(list.map(async (s) => (await getQuiz(s.quizId))?.title ?? s.quizId));
    text += list.map((s, i) => `${i + 1}. <b>${esc(trunc(titles[i], 36))}</b>\n   ${fmtDays(s.days)} · ${s.time}`).join("\n");
    list.forEach((s, i) => kb.text(`❌ ${i + 1}`, `sc:${chatId}:x:${s.id}`));
    kb.row();
  } else {
    text += "Hozircha reja yo'q.";
  }
  text += `\n\n<i>Vaqt Toshkent bo'yicha. Test belgilangan vaqtdan keyin 5 daqiqa ichida boshlanadi: guruhga kutish xonasi chiqadi va odamlar «Tayyorman» bosadi.</i>`;
  if (list.length < MAX_SCHEDULES_PER_CHAT) kb.text("➕ Reja qo'shish", `sc:${chatId}:add`).row();
  kb.text("⬅️ Sozlamalarga", `s:${chatId}`);
  if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

function daysKeyboard(days) {
  const kb = new InlineKeyboard();
  DAY_ORDER.forEach((d, i) => {
    kb.text(`${days.includes(d) ? "✅ " : ""}${DAY_NAMES[d]}`, `sd:${d}`);
    if (i === 3) kb.row();
  });
  kb.row().text(days.length === 7 ? "✅ Har kuni" : "Har kuni", "sd:all").row().text("➡️ Davom etish (vaqtni yozish)", "sd:ok");
  return kb;
}

export function registerSched(bot) {
  bot.callbackQuery(/^sc:(-?\d+)(?::(\w+)(?::([\w-]+))?)?$/, async (ctx) => {
    const [, chatId, action, arg] = ctx.match;
    const viewer = ctx.callbackQuery.message?.chat;
    if (!viewer) return ctx.answerCallbackQuery();
    const { chat } = await targetChat(chatId);
    if (chat.type !== "private" && viewer.type !== "private" && chat.id !== viewer.id) return ctx.answerCallbackQuery();
    if (!(await isAdmin(chat, ctx.from))) return ctx.answerCallbackQuery({ text: ADMIN_ONLY, show_alert: true });

    switch (action) {
      case undefined:
        await ctx.answerCallbackQuery();
        return showList(ctx, chatId, true);

      case "x": {
        const s = await getJSON(`sched/${arg}`);
        if (s && s.chatId === chat.id) await del(`sched/${arg}`);
        await ctx.answerCallbackQuery({ text: "Reja o'chirildi" });
        return showList(ctx, chatId, true);
      }

      case "add": {
        const kb = new InlineKeyboard();
        for (const q of quizzes.values()) kb.text(`🎯 ${trunc(q.title, 32)}`, `sc:${chatId}:q:${q.id}`).row();
        for (const k of await listKeys(`uq/${ctx.from.id}/`)) {
          const info = await getJSON(k);
          const id = k.split("/")[2];
          if (info) kb.text(`📚 ${trunc(info.title, 32)}`, `sc:${chatId}:q:${id}`).row();
        }
        kb.text("⬅️ Orqaga", `sc:${chatId}`);
        await ctx.answerCallbackQuery();
        return ctx.editMessageText("⏰ Qaysi testni rejalashtiramiz?", { reply_markup: kb }).catch(() => {});
      }

      case "q": {
        const quiz = await getQuiz(arg);
        if (!quiz) return ctx.answerCallbackQuery({ text: "Test topilmadi.", show_alert: true });
        await setJSON(stateKey(ctx.from.id), { chatId: chat.id, quizId: quiz.id, days: [1, 2, 3, 4, 5], step: "days" });
        await ctx.answerCallbackQuery();
        return ctx.editMessageText(`⏰ <b>${esc(quiz.title)}</b>\n\nQaysi kunlari o'tkaziladi?`, { parse_mode: "HTML", reply_markup: daysKeyboard([1, 2, 3, 4, 5]) }).catch(() => {});
      }
    }
    return ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sd:(\w+)$/, async (ctx) => {
    const st = await getJSON(stateKey(ctx.from.id));
    if (!st || st.step !== "days") return ctx.answerCallbackQuery({ text: "Bu amal eskirgan.", show_alert: true });
    const arg = ctx.match[1];
    if (arg === "ok") {
      if (!st.days.length) return ctx.answerCallbackQuery({ text: "Kamida bitta kunni tanlang.", show_alert: true });
      st.step = "time";
      await setJSON(stateKey(ctx.from.id), st);
      await ctx.answerCallbackQuery();
      return ctx.reply(`🕐 Vaqtni yozing (Toshkent vaqti bilan, masalan <code>19:00</code>).\nKunlar: <b>${fmtDays(st.days)}</b>\nBekor qilish: /cancel`, {
        parse_mode: "HTML",
        reply_markup: { force_reply: true, input_field_placeholder: "19:00" },
      });
    }
    if (arg === "all") st.days = st.days.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6];
    else {
      const d = Number(arg);
      st.days = st.days.includes(d) ? st.days.filter((x) => x !== d) : [...st.days, d];
    }
    await setJSON(stateKey(ctx.from.id), st);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: daysKeyboard(st.days) }).catch(() => {});
  });

  bot.command("cancel", async (ctx, next) => {
    if (!ctx.from || !(await getJSON(stateKey(ctx.from.id)))) return next();
    await del(stateKey(ctx.from.id));
    await ctx.reply("❌ Bekor qilindi.");
  });
}

/** Vaqt matni kutilayotgan bo'lsa qayta ishlaydi; qayta ishlansa true */
export async function handleSchedText(ctx) {
  if (!ctx.from) return false;
  const st = await getJSON(stateKey(ctx.from.id));
  if (!st || st.step !== "time") return false;
  const time = parseClock(ctx.msg.text);
  if (!time) {
    await ctx.reply("⚠️ Vaqtni <code>19:00</code> ko'rinishida yozing.", { parse_mode: "HTML" });
    return true;
  }
  await del(stateKey(ctx.from.id));
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  await setJSON(`sched/${id}`, { id, chatId: st.chatId, quizId: st.quizId, days: st.days, time, createdBy: ctx.from.id, lastRun: null });
  const quiz = await getQuiz(st.quizId);
  await ctx.reply(`✅ Reja qo'shildi: <b>${esc(quiz?.title ?? st.quizId)}</b>\n${fmtDays(st.days)} · ${time} (Toshkent)`, { parse_mode: "HTML" });
  await showList(ctx, st.chatId, false);
  return true;
}
