// Telegram webhook: har bir xabar/tugma bosilishi shu yerga keladi
import { InlineKeyboard, Keyboard, webhookCallback } from "grammy";
import {
  bot, TOKEN, SECRET, OWNER_ID, quizzes, ACCESS_LABELS, NO_ACCESS, ADMIN_ONLY, DISABLED_TEXT,
  TIME_CHOICES, MIN_TIME, MAX_TIME, MIN_PLAYERS_CHOICES, GAP_CHOICES, WAIT_CHOICES, TOGGLES,
  getChat, updateChat, rememberChat, targetChat, timeOf, accessOf, managersOf, enabledOf, isGroupType,
  isAdmin, canManage, settingsPanel, lobbyText, lobbyKeyboard,
  getSession, readyNames, startQuiz, stopQuiz, getQuiz, setSiteUrl, botUsername,
  getJSON, setJSON, getText, setText, del, listKeys,
  esc, userName, fmtTime, parseTime, validTime, trunc,
} from "../../lib/core.js";
import { registerWizard, handleWizardText } from "../../lib/wizard.js";
import { registerSched, handleSchedText, countSchedules } from "../../lib/sched.js";
import { getUser, statsText } from "../../lib/stats.js";
import { lastReport } from "../../lib/results.js";
import {
  reportError, isOwner, adminText, adminKeyboard, groupsText, errorsText, sendBackup, restoreBackup, downloadTelegramFile,
} from "../../lib/admin.js";

const start = (chat, quizId, opts) => startQuiz(chat, quizId, opts);

// ---------- yordamchilar ----------

function quizListKeyboard() {
  const kb = new InlineKeyboard();
  for (const q of quizzes.values()) kb.text(`▶️ ${q.title}`, `start:${q.id}`).row();
  return kb;
}

async function showPanel(ctx, targetId, edit) {
  const { chat, s } = await targetChat(targetId);
  const sc = isGroupType(chat.type) ? await countSchedules(chat.id) : 0;
  const { text, kb } = settingsPanel(chat, s, ctx.chat.type, sc);
  if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

/** Foydalanuvchi admin bo'lgan guruh va kanallar */
async function adminGroups(user) {
  const keys = await listKeys("chat/");
  const chats = await Promise.all(keys.map(async (k) => ({ id: Number(k.slice(5)), ...(await getJSON(k)) })));
  const candidates = chats.filter((c) => (isGroupType(c.type) || c.type === "channel") && !c.left);
  const checks = await Promise.all(candidates.map(async (c) => ((await isAdmin({ id: c.id, type: c.type }, user)) ? c : null)));
  return checks.filter(Boolean);
}

async function showGroupList(ctx, edit) {
  const groups = await adminGroups(ctx.from);
  const kb = new InlineKeyboard();
  for (const g of groups) {
    kb.text(`${enabledOf(g) ? "🟢" : "🔴"} ${g.type === "channel" ? "📢" : "👥"} ${g.title ?? g.id}`, `s:${g.id}`).row();
  }
  kb.text("⚙️ Shaxsiy chat sozlamalari", `s:${ctx.from.id}`);
  const text = groups.length
    ? "👥 <b>Mening guruhlarim</b>\n\nSiz admin bo'lgan guruh va kanallar. Sozlash uchun tanlang:\n🟢 — testlar yoqilgan, 🔴 — o'chirilgan"
    : "👥 <b>Mening guruhlarim</b>\n\nHozircha ro'yxat bo'sh.\n\n" +
      "1. Botni guruhingizga qo'shing (yoki u allaqachon bo'lsa, guruhda /settings yozing).\n" +
      "2. Siz o'sha guruhda admin bo'lishingiz kerak.\n" +
      "Keyin shu ro'yxatni qayta oching.";
  if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

async function stopAndReport(ctx, chatId) {
  const result = await stopQuiz(chatId);
  if (result === "cleared") await ctx.reply("⏹ Test to'xtatildi.");
  return result;
}

// ---------- bot qaysi guruhlarda ekanini kuzatish ----------

bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== "private") await rememberChat(ctx.chat);
  await next();
});

bot.on("my_chat_member", async (ctx) => {
  const status = ctx.myChatMember.new_chat_member.status;
  if (status === "left" || status === "kicked") {
    await updateChat(ctx.chat.id, { left: true });
    await stopQuiz(ctx.chat.id);
  }
});

// ---------- kanal: admin kanalga "/quiz to_be_1" yozadi ----------

bot.on("channel_post:text", async (ctx) => {
  const m = ctx.channelPost.text.match(/^\/(quiz|stop|settings|time)(?:@\w+)?(?:\s+(\S+))?/);
  if (!m) return;
  await ctx.deleteMessage().catch(() => {});

  if (m[1] === "time") {
    const t = parseTime(m[2] ?? "");
    const ok = validTime(t);
    if (ok) await updateChat(ctx.chat.id, { time: t });
    await ctx.reply(ok ? `✅ Har bir savolga ${fmtTime(t)} beriladi.` : `⚠️ Masalan: /time 25 (${MIN_TIME}–${MAX_TIME} soniya)`);
  } else if (m[1] === "settings") {
    await ctx.reply("⚙️ Kanal sozlamalarini botning shaxsiy chatida oching: botga /groups yuboring.");
  } else if (m[1] === "stop") {
    await stopQuiz(ctx.chat.id);
  } else if (m[2]) {
    await start(ctx.chat, m[2], { skipConfirm: true });
  } else {
    await ctx.reply(`Testni tanlab yozing:\n${[...quizzes.values()].map((q) => `/quiz ${q.id} — ${q.title}`).join("\n")}`);
  }
});

// ---------- buyruqlar ----------

// Buyruqlar message:text handleridan OLDIN ro'yxatdan o'tishi shart (u hamma matnni to'xtatadi)
registerSched(bot);
registerWizard(bot);

bot.command("start", async (ctx) => {
  const payload = ctx.match?.trim();

  // Guruhga "👥 Guruhda" tugmasi yoki havola orqali qo'shilganda
  if (payload && ctx.chat.type !== "private") {
    if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
    return start(ctx.chat, payload, { startedBy: ctx.from?.id, skipConfirm: true });
  }

  // Ulashish havolasi orqali: test kartochkasi
  if (payload && ctx.chat.type === "private") {
    const quiz = await getQuiz(payload);
    if (!quiz) return ctx.reply("⚠️ Bu havola bo'yicha test topilmadi. U o'chirilgan bo'lishi mumkin.");
    const uname = await botUsername();
    const kb = new InlineKeyboard().text("▶️ Boshlash", `start:${quiz.id}`).url("👥 Guruhda", `https://t.me/${uname}?startgroup=${quiz.id}`);
    return ctx.reply(
      `🎯 <b>${esc(quiz.title)}</b>\n${quiz.description ? `${esc(quiz.description)}\n` : ""}\n📝 ${quiz.questions.length} ta savol\n\nBoshlash uchun tugmani bosing:`,
      { parse_mode: "HTML", reply_markup: kb },
    );
  }

  if (ctx.chat.type !== "private") return ctx.reply("Test tanlash: /quiz");

  const uname = ctx.me.username;
  const kb = new InlineKeyboard();
  for (const q of quizzes.values()) {
    kb.text(`▶️ ${q.title}`, `start:${q.id}`).url("👥 Guruhda", `https://t.me/${uname}?startgroup=${q.id}`).row();
  }
  kb.text("📋 Testlarim", "q:l").text("➕ Yangi test", "q:new").row();
  kb.text("📈 Statistika", "ms").text("⚙️ Sozlamalar", `s:${ctx.from.id}`).row();
  kb.text("👥 Mening guruhlarim", "glist");
  await ctx.reply(
    "Salom! Men quiz botman 🎯\n\n" +
      "▶️ — testni shu yerda yechish\n" +
      "👥 Guruhda — botni guruhga qo'shib, testni o'sha yerda boshlash\n" +
      "📋 Testlarim / ➕ Yangi test — o'z testlaringizni yaratish va boshqarish\n" +
      "📈 Statistika — natijalaringiz, seriya va nishonlar\n" +
      "👥 Mening guruhlarim — guruhlaringizni boshqarish\n\n" +
      "Yordam: /help",
    { parse_mode: "HTML", reply_markup: kb },
  );
});

bot.command("quiz", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  if (!enabledOf(await getChat(ctx.chat.id))) return ctx.reply(DISABLED_TEXT);
  const id = ctx.match?.trim();
  if (id) return start(ctx.chat, id, { startedBy: ctx.from?.id });
  await ctx.reply("Qaysi testni boshlaymiz?", { reply_markup: quizListKeyboard() });
});

bot.command("stop", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  if (!(await stopAndReport(ctx, ctx.chat.id))) await ctx.reply("Hozir hech qanday test ketmayapti.");
});

bot.command("pause", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  const s = await getSession(ctx.chat.id);
  if (!s || s.phase !== "running") return ctx.reply("Hozir pauzaga qo'yadigan test yo'q (yoki u hali boshlanmagan).");
  await setText(`pause/${ctx.chat.id}/${s.runId}`, "1");
  await ctx.reply("⏸ <b>Pauza.</b> Joriy savol tugagach test to'xtaydi.\nDavom ettirish: /resume", { parse_mode: "HTML" });
});

bot.command("resume", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  const s = await getSession(ctx.chat.id);
  const key = s && `pause/${ctx.chat.id}/${s.runId}`;
  if (!s || (await getText(key)) === null) return ctx.reply("Pauzada turgan test yo'q.");
  await del(key);
  await ctx.reply("▶️ Test davom etmoqda!");
});

bot.command("report", async (ctx) => {
  if (!isGroupType(ctx.chat.type)) return ctx.reply("Hisobot guruh testlari uchun. Uni guruhda yozing: /report");
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  const text = await lastReport(ctx.chat.id);
  await ctx.reply(text ?? "Hali hisobot yo'q — avval guruhda test o'tkazing.", { parse_mode: "HTML" });
});

bot.command("mystats", async (ctx) => {
  if (!ctx.from) return;
  const u = await getUser(ctx.from.id);
  const kb = u.wrong.length ? new InlineKeyboard().text(`🔁 Xatolar ustida ishlash (${Math.min(u.wrong.length, 10)})`, "mx") : undefined;
  await ctx.reply(statsText(u), { parse_mode: "HTML", reply_markup: kb });
});

bot.command("help", (ctx) =>
  ctx.reply(
    "<b>Testlar</b>\n" +
      "/quiz — testlar ro'yxati\n" +
      "/quiz test_id — testni darhol boshlash\n" +
      "/stop — ketayotgan testni to'xtatish\n" +
      "/pause, /resume — testni pauzaga qo'yish va davom ettirish\n" +
      "/practice — yakka mashq (shaxsiy chatda)\n\n" +
      "<b>O'z testlaringiz (shaxsiy chatda)</b>\n" +
      "/newquiz — yangi test yaratish\n" +
      "/vocab — lug'atdan test yaratish\n" +
      "/mytests — mening testlarim\n\n" +
      "<b>Natijalar</b>\n" +
      "/mystats — statistika, seriya, nishonlar\n" +
      "/report — oxirgi guruh testi hisoboti\n\n" +
      "<b>Sozlamalar</b>\n" +
      "/settings — sozlamalar\n" +
      "/groups — mening guruhlarim (shaxsiy chatda)\n" +
      "/time 25 — har bir savolga 25 soniya (5–600, masalan 2m)\n" +
      "/manager — (guruhda, odamning xabariga javob qilib) boshqarish huquqini berish yoki olish\n\n" +
      "Guruhda test kamida belgilangan sondagi odam «✋ Men tayyorman» bosgach boshlanadi. " +
      "Savollar va variantlar aralashtiriladi, oxirida reyting chiqadi.\n\n" +
      "<b>Testlar:</b>\n" +
      [...quizzes.values()].map((q) => `• <code>${q.id}</code> — ${esc(q.title)} (${q.questions.length} ta savol)`).join("\n"),
    { parse_mode: "HTML" },
  ),
);

bot.callbackQuery(/^start:(.+)$/, async (ctx) => {
  const chat = ctx.callbackQuery.message?.chat;
  if (!chat) return ctx.answerCallbackQuery();
  if (!(await canManage(chat, ctx.from))) return ctx.answerCallbackQuery({ text: NO_ACCESS, show_alert: true });
  await ctx.answerCallbackQuery();
  if (chat.type !== "private") await ctx.deleteMessage().catch(() => {});
  await start(chat, ctx.match[1], { startedBy: ctx.from.id });
});

// Boshlashdan oldin tasdiq
bot.callbackQuery(/^cf:y:(.+)$/, async (ctx) => {
  const chat = ctx.callbackQuery.message?.chat;
  if (!chat) return ctx.answerCallbackQuery();
  if (!(await canManage(chat, ctx.from))) return ctx.answerCallbackQuery({ text: NO_ACCESS, show_alert: true });
  await ctx.answerCallbackQuery();
  await ctx.deleteMessage().catch(() => {});
  await start(chat, ctx.match[1], { startedBy: ctx.from.id, skipConfirm: true });
});

bot.callbackQuery("cf:n", async (ctx) => {
  const chat = ctx.callbackQuery.message?.chat;
  if (!chat) return ctx.answerCallbackQuery();
  if (!(await canManage(chat, ctx.from))) return ctx.answerCallbackQuery({ text: NO_ACCESS, show_alert: true });
  await ctx.answerCallbackQuery({ text: "Bekor qilindi" });
  await ctx.deleteMessage().catch(() => {});
});

// ---------- kutish xonasi ----------

bot.callbackQuery("lobby:join", async (ctx) => {
  const chatId = ctx.chat?.id;
  const session = chatId && (await getSession(chatId));
  if (!session || (session.phase !== "lobby" && session.phase !== "countdown")) {
    return ctx.answerCallbackQuery({ text: "Bu test allaqachon boshlangan yoki tugagan." });
  }
  const key = `ready/${chatId}/${session.runId}/${ctx.from.id}`;
  if (await getText(key)) return ctx.answerCallbackQuery({ text: "Siz allaqachon ro'yxatdasiz ✅" });

  await setText(key, userName(ctx.from));
  await ctx.answerCallbackQuery({ text: "✅ Siz ro'yxatga qo'shildingiz!" });

  const names = await readyNames(chatId, session.runId);
  const countdown = session.phase === "countdown" || names.length >= session.min;
  await ctx.editMessageText(lobbyText({ ...session, names, countdown }), { parse_mode: "HTML", reply_markup: lobbyKeyboard() }).catch(() => {});
});

bot.callbackQuery("lobby:now", async (ctx) => {
  const session = ctx.chat && (await getSession(ctx.chat.id));
  if (!session || (session.phase !== "lobby" && session.phase !== "countdown")) return ctx.answerCallbackQuery({ text: "Bu test allaqachon boshlangan yoki tugagan." });
  if (!(await canManage(ctx.chat, ctx.from))) return ctx.answerCallbackQuery({ text: NO_ACCESS, show_alert: true });
  const ready = (await readyNames(ctx.chat.id, session.runId)).length;
  if (ready < session.min) {
    return ctx.answerCallbackQuery({ text: `Avval kamida ${session.min} kishi «Tayyorman» bosishi kerak (hozir ${ready}).`, show_alert: true });
  }
  await setText(`start/${ctx.chat.id}/${session.runId}`, "1");
  await ctx.answerCallbackQuery({ text: "▶️ Test boshlanmoqda..." });
});

bot.callbackQuery("lobby:cancel", async (ctx) => {
  const session = ctx.chat && (await getSession(ctx.chat.id));
  if (!session || (session.phase !== "lobby" && session.phase !== "countdown")) return ctx.answerCallbackQuery();
  if (!(await canManage(ctx.chat, ctx.from))) return ctx.answerCallbackQuery({ text: NO_ACCESS, show_alert: true });
  await ctx.answerCallbackQuery({ text: "Bekor qilinmoqda..." });
  await stopAndReport(ctx, ctx.chat.id);
});

// ---------- xatolar ustida ishlash va statistika ----------

bot.callbackQuery("mx", async (ctx) => {
  const chat = ctx.callbackQuery.message?.chat;
  if (!chat || chat.type !== "private") return ctx.answerCallbackQuery({ text: "Buni botning shaxsiy chatida bosing.", show_alert: true });
  const u = await getUser(ctx.from.id);
  if (!u.wrong.length) return ctx.answerCallbackQuery({ text: "Xatolar ro'yxati bo'sh 🎉", show_alert: true });
  await ctx.answerCallbackQuery();
  const items = u.wrong.slice(-10);
  await start(chat, "mistakes", {
    custom: { id: "mistakes", title: "Xatolar ustida ishlash", description: "", questions: items.map((w) => ({ ...w.q, key: w.key })) },
    kind: "mistakes",
    skipConfirm: true,
    startedBy: ctx.from.id,
  });
});

bot.callbackQuery("ms", async (ctx) => {
  await ctx.answerCallbackQuery();
  const u = await getUser(ctx.from.id);
  const kb = u.wrong.length ? new InlineKeyboard().text(`🔁 Xatolar ustida ishlash (${Math.min(u.wrong.length, 10)})`, "mx") : undefined;
  await ctx.reply(statsText(u), { parse_mode: "HTML", reply_markup: kb });
});

// ---------- sozlamalar ----------

bot.command("settings", async (ctx) => {
  if (ctx.chat.type === "private") return showPanel(ctx, ctx.chat.id);
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  await showPanel(ctx, ctx.chat.id);
});

bot.command("groups", async (ctx) => {
  if (ctx.chat.type !== "private") return ctx.reply("Bu buyruq botning shaxsiy chatida ishlaydi.");
  await showGroupList(ctx);
});

bot.callbackQuery("glist", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (ctx.chat?.type === "private") await showGroupList(ctx, true);
});

bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());

bot.callbackQuery(/^s:(-?\d+)(?::(\w+)(?::([\w-]+))?)?$/, async (ctx) => {
  const [, targetId, action, arg] = ctx.match;
  const viewer = ctx.callbackQuery.message?.chat;
  if (!viewer) return ctx.answerCallbackQuery();

  const { chat: target, s } = await targetChat(targetId);
  // Shaxsiy chat sozlamalari faqat o'sha chatda; boshqa guruh sozlamalari faqat botning shaxsiy chatidan
  if (target.type === "private" && target.id !== viewer.id) return ctx.answerCallbackQuery();
  if (target.type !== "private" && viewer.type !== "private" && target.id !== viewer.id) return ctx.answerCallbackQuery();

  const adminOnly = ["en", "a", "md", "ma"].includes(action);
  const allowed = adminOnly ? await isAdmin(target, ctx.from) : await canManage(target, ctx.from);
  if (!allowed) return ctx.answerCallbackQuery({ text: adminOnly ? ADMIN_ONLY : NO_ACCESS, show_alert: true });

  switch (action) {
    case undefined:
      await ctx.answerCallbackQuery();
      return showPanel(ctx, target.id, viewer.type === "private");

    case "en": {
      const enabled = !enabledOf(s);
      await updateChat(target.id, { enabled });
      if (!enabled && (await stopQuiz(target.id))) {
        await bot.api.sendMessage(target.id, "🔴 Testlar admin tomonidan o'chirildi.").catch(() => {});
      }
      await ctx.answerCallbackQuery({ text: enabled ? "🟢 Testlar yoqildi" : "🔴 Testlar o'chirildi" });
      return showPanel(ctx, target.id, true);
    }

    case "t": {
      const t = Number(arg);
      if (!TIME_CHOICES.includes(t)) return ctx.answerCallbackQuery();
      await updateChat(target.id, { time: t });
      await ctx.answerCallbackQuery({ text: `Har bir savolga ${fmtTime(t)} (keyingi testdan)` });
      return showPanel(ctx, target.id, true);
    }

    case "gp": {
      const g = Number(arg);
      if (!GAP_CHOICES.includes(g)) return ctx.answerCallbackQuery();
      await updateChat(target.id, { gap: g });
      await ctx.answerCallbackQuery({ text: `Savollar orasida ${g} soniya (keyingi testdan)` });
      return showPanel(ctx, target.id, true);
    }

    case "wt": {
      const w = Number(arg);
      if (!WAIT_CHOICES.includes(w)) return ctx.answerCallbackQuery();
      await updateChat(target.id, { wait: w });
      await ctx.answerCallbackQuery({ text: `Yetarli odam yig'ilgach ${fmtTime(w)} kutiladi` });
      return showPanel(ctx, target.id, true);
    }

    case "tg": {
      if (!TOGGLES[arg]) return ctx.answerCallbackQuery();
      const [field, label, def] = TOGGLES[arg];
      const on = !(s[field] ?? def);
      await updateChat(target.id, { [field]: on });
      await ctx.answerCallbackQuery({ text: `${label}: ${on ? "yoqildi" : "o'chirildi"}` });
      return showPanel(ctx, target.id, true);
    }

    case "mp": {
      const n = Number(arg);
      if (!MIN_PLAYERS_CHOICES.includes(n)) return ctx.answerCallbackQuery();
      await updateChat(target.id, { minPlayers: n });
      await ctx.answerCallbackQuery({ text: `Test kamida ${n} kishi tayyor bo'lganda boshlanadi` });
      return showPanel(ctx, target.id, true);
    }

    case "tc":
      await ctx.answerCallbackQuery();
      if (viewer.type === "channel") return ctx.reply("Kanalda vaqtni shunday yozing: /time 25");
      await setJSON(`await/time/${viewer.id}`, { userId: ctx.from.id, target: target.id });
      return ctx.reply(
        `✏️ ${target.title ? `<b>${esc(target.title)}</b> uchun h` : "H"}ar bir savol vaqtini soniyada yozing (${MIN_TIME}–${MAX_TIME}).\nMasalan: 25, 90 yoki 2m`,
        { parse_mode: "HTML", reply_markup: { force_reply: true, input_field_placeholder: "Masalan: 25" } },
      );

    case "a":
      if (!ACCESS_LABELS[arg]) return ctx.answerCallbackQuery();
      await updateChat(target.id, { access: arg });
      await ctx.answerCallbackQuery({ text: `Testni boshqaradi: ${ACCESS_LABELS[arg]}` });
      return showPanel(ctx, target.id, true);

    case "md": {
      const managers = { ...managersOf(s) };
      const name = managers[arg];
      delete managers[arg];
      await updateChat(target.id, { managers });
      await ctx.answerCallbackQuery({ text: name ? `${name} ro'yxatdan olib tashlandi.` : "Olib tashlandi." });
      return showPanel(ctx, target.id, true);
    }

    case "ma": {
      if (viewer.type !== "private") {
        return ctx.answerCallbackQuery({
          text: "Kerakli odamning xabariga javob (reply) qilib /manager yozing. Yoki botning shaxsiy chatidan qo'shing.",
          show_alert: true,
        });
      }
      await ctx.answerCallbackQuery();
      const requestId = Math.floor(Math.random() * 2 ** 30);
      await setJSON(`await/mgr/${ctx.from.id}`, { target: target.id, requestId });
      const kb = new Keyboard()
        .requestUsers("👤 Odamni tanlash", requestId, { user_is_bot: false, max_quantity: 10, request_name: true, request_username: true })
        .row()
        .text("Bekor qilish")
        .resized()
        .oneTime();
      return ctx.reply(
        `<b>${esc(target.title ?? "Guruh")}</b> uchun testni boshqaradigan odamlarni tanlang (10 tagacha).\n\n` +
          "Pastdagi <b>👤 Odamni tanlash</b> tugmasini bosing.\n" +
          "<i>Ro'yxatda kerakli odam chiqmasa, guruhda uning xabariga javob qilib /manager yozing.</i>",
        { parse_mode: "HTML", reply_markup: kb },
      );
    }
  }
  return ctx.answerCallbackQuery();
});

// Shaxsiy chatda tanlangan odamlar
bot.on("message:users_shared", async (ctx) => {
  const pending = await getJSON(`await/mgr/${ctx.from.id}`);
  const shared = ctx.msg.users_shared;
  if (!pending || pending.requestId !== shared.request_id) return;
  await del(`await/mgr/${ctx.from.id}`);

  const { chat: target, s } = await targetChat(pending.target);
  if (!(await isAdmin(target, ctx.from))) return ctx.reply(ADMIN_ONLY, { reply_markup: { remove_keyboard: true } });

  const managers = { ...managersOf(s) };
  for (const u of shared.users) managers[u.user_id] = userName(u);
  await updateChat(target.id, { managers, access: "list" });

  await ctx.reply(`✅ Qo'shildi: ${shared.users.map((u) => esc(userName(u))).join(", ")}`, {
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
  await showPanel(ctx, target.id);
});

bot.command("time", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  const arg = ctx.match?.trim();
  if (!arg) {
    return ctx.reply(`Hozir: ${fmtTime(timeOf(await getChat(ctx.chat.id)))}.\nO'zgartirish: /time 25 (${MIN_TIME}–${MAX_TIME} soniya, masalan 2m = 2 daqiqa)`);
  }
  const t = parseTime(arg);
  if (!validTime(t)) return ctx.reply(`⚠️ ${MIN_TIME} dan ${MAX_TIME} soniyagacha son yozing. Masalan: 25 yoki 2m.`);
  await updateChat(ctx.chat.id, { time: t });
  await ctx.reply(`✅ Har bir savolga ${fmtTime(t)} beriladi.`);
});

bot.command("manager", async (ctx) => {
  if (!isGroupType(ctx.chat.type)) {
    return ctx.reply("Bu buyruq guruhda ishlaydi. Shaxsiy chatdan qo'shish: /groups → guruh → Adminlar + tanlanganlar → ➕ Odam qo'shish.");
  }
  if (!(await isAdmin(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(ADMIN_ONLY);
  const user = ctx.msg.reply_to_message?.from;
  if (!user || user.is_bot) return ctx.reply("Kerakli odamning xabariga javob (reply) qilib /manager yozing.");

  const s = await getChat(ctx.chat.id);
  const managers = { ...managersOf(s) };
  const added = !managers[user.id];
  if (added) managers[user.id] = userName(user);
  else delete managers[user.id];
  const patch = { managers };
  if (added && accessOf(s) !== "list") patch.access = "list";
  await updateChat(ctx.chat.id, patch);

  const name = esc(userName(user));
  await ctx.reply(
    added ? `✅ <b>${name}</b> endi testni boshqara oladi (boshlash, to'xtatish, vaqt).` : `❌ <b>${name}</b> ro'yxatdan olib tashlandi.`,
    { parse_mode: "HTML" },
  );
});

// ---------- bot egasi: /admin, zaxira, tiklash ----------

bot.command("admin", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  if (!isOwner(ctx.from.id)) {
    return ctx.reply(
      (OWNER_ID ? "Bu buyruq faqat bot egasi uchun." : "Bot egasi hali sozlanmagan.") + `\nSizning Telegram ID: <code>${ctx.from.id}</code>`,
      { parse_mode: "HTML" },
    );
  }
  await ctx.reply(await adminText(), { parse_mode: "HTML", reply_markup: adminKeyboard() });
});

bot.callbackQuery(/^ad:(\w+)$/, async (ctx) => {
  if (!isOwner(ctx.from.id)) return ctx.answerCallbackQuery({ text: "Faqat bot egasi uchun.", show_alert: true });
  const action = ctx.match[1];
  const back = new InlineKeyboard().text("⬅️ Orqaga", "ad:rf");
  if (action === "bk") {
    await ctx.answerCallbackQuery({ text: "Zaxira tayyorlanmoqda..." });
    await sendBackup(OWNER_ID, "Qo'lda olingan zaxira");
    return;
  }
  await ctx.answerCallbackQuery();
  if (action === "gr") return ctx.editMessageText(await groupsText(), { parse_mode: "HTML", reply_markup: back });
  if (action === "er") return ctx.editMessageText(await errorsText(), { parse_mode: "HTML", reply_markup: back });
  return ctx.editMessageText(await adminText(), { parse_mode: "HTML", reply_markup: adminKeyboard() }).catch(() => {});
});

bot.command("restore", async (ctx) => {
  if (ctx.chat.type !== "private" || !isOwner(ctx.from.id)) return;
  const doc = ctx.msg.reply_to_message?.document;
  if (!doc) return ctx.reply("Zaxira fayliga javob (reply) qilib /restore yozing.");
  try {
    const n = await restoreBackup(JSON.parse(await downloadTelegramFile(doc.file_id)));
    await ctx.reply(`✅ Tiklandi: ${n} ta yozuv.`);
  } catch (e) {
    await ctx.reply(`⚠️ Tiklab bo'lmadi: ${esc(e.message)}`, { parse_mode: "HTML" });
  }
});

// ---------- matnli javoblar ----------

bot.on("message:text", async (ctx) => {
  if (ctx.chat.type === "private" && ctx.msg.text === "Bekor qilish") {
    await del(`await/mgr/${ctx.from.id}`);
    return ctx.reply("Bekor qilindi.", { reply_markup: { remove_keyboard: true } });
  }

  if (await handleWizardText(ctx)) return;
  if (await handleSchedText(ctx)) return;

  const pending = await getJSON(`await/time/${ctx.chat.id}`);
  if (!pending || pending.userId !== ctx.from?.id) return;

  const t = parseTime(ctx.msg.text);
  if (!validTime(t)) return ctx.reply(`⚠️ ${MIN_TIME} dan ${MAX_TIME} soniyagacha son yozing. Masalan: 25 yoki 2m (2 daqiqa).`);
  await del(`await/time/${ctx.chat.id}`);
  const s = await updateChat(pending.target, { time: t });
  await ctx.reply(`✅ ${s.title ? `<b>${esc(s.title)}</b>: h` : "H"}ar bir savolga ${fmtTime(t)} beriladi.`, { parse_mode: "HTML" });
  await showPanel(ctx, pending.target);
});

// ---------- javoblarni yozib borish ----------

bot.on("poll_answer", async (ctx) => {
  const ans = ctx.pollAnswer;
  if (!ans.user || !ans.option_ids?.length) return;
  const p = await getJSON(`poll/${ans.poll_id}`);
  if (!p) return;

  const ok = ans.option_ids[0] === p.correct ? 1 : 0;
  const ms = Date.now() - p.sentAt;
  const base = `${p.chatId}/${p.runId}/${ans.user.id}`;
  await Promise.all([setText(`ans/${base}/${ans.poll_id}~${ok}~${ms}`, "1"), setText(`name/${base}`, userName(ans.user))]);
});

bot.catch(async (err) => {
  await reportError("telegram", err.error ?? err, err.ctx?.chat ? `chat ${err.ctx.chat.id}` : "");
});

// ---------- Netlify funksiyasi ----------

const handleUpdate = webhookCallback(bot, "std/http", { secretToken: SECRET, timeoutMilliseconds: 9000 });

export default async (req) => {
  if (!TOKEN || !SECRET) return new Response("BOT_TOKEN yoki WEBHOOK_SECRET sozlanmagan", { status: 500 });
  if (req.method !== "POST") return new Response("Linguify Quiz webhook ishlayapti ✅");
  setSiteUrl(new URL(req.url).origin);
  return handleUpdate(req);
};
