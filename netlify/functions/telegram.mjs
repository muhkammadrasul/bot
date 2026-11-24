// Telegram webhook: har bir xabar/tugma bosilishi shu yerga keladi
import { InlineKeyboard, Keyboard, webhookCallback } from "grammy";
import {
  bot, TOKEN, SECRET, quizzes, ACCESS_LABELS, NO_ACCESS, ADMIN_ONLY, DISABLED_TEXT,
  TIME_CHOICES, MIN_TIME, MAX_TIME, MIN_PLAYERS_CHOICES,
  getChat, updateChat, rememberChat, targetChat, timeOf, accessOf, managersOf, enabledOf, isGroupType,
  isAdmin, canManage, settingsPanel, lobbyText, lobbyKeyboard,
  getSession, readyNames, startQuiz, stopQuiz,
  getJSON, setJSON, getText, setText, del, listKeys,
  esc, userName, fmtTime, parseTime, validTime,
} from "../../lib/core.js";

let SITE_URL = process.env.URL;

// ---------- yordamchilar ----------

function quizListKeyboard() {
  const kb = new InlineKeyboard();
  for (const q of quizzes.values()) kb.text(`▶️ ${q.title}`, `start:${q.id}`).row();
  return kb;
}

async function showPanel(ctx, targetId, edit) {
  const { chat, s } = await targetChat(targetId);
  const { text, kb } = settingsPanel(chat, s, ctx.chat.type);
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

const start = (chat, quizId) => startQuiz(chat, quizId, SITE_URL);

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
    await start(ctx.chat, m[2]);
  } else {
    await ctx.reply(`Testni tanlab yozing:\n${[...quizzes.values()].map((q) => `/quiz ${q.id} — ${q.title}`).join("\n")}`);
  }
});

// ---------- buyruqlar ----------

bot.command("start", async (ctx) => {
  const payload = ctx.match?.trim();

  // Guruhga "👥 Guruhda" tugmasi orqali qo'shilganda
  if (payload && ctx.chat.type !== "private") {
    if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
    return start(ctx.chat, payload);
  }
  if (payload) return start(ctx.chat, payload);
  if (ctx.chat.type !== "private") return ctx.reply("Test tanlash: /quiz");

  const kb = new InlineKeyboard();
  for (const q of quizzes.values()) {
    kb.text(`▶️ ${q.title}`, `start:${q.id}`).url("👥 Guruhda", `https://t.me/${ctx.me.username}?startgroup=${q.id}`).row();
  }
  kb.text("⚙️ Sozlamalar", `s:${ctx.from.id}`).text("👥 Mening guruhlarim", "glist");
  await ctx.reply(
    "Salom! Men quiz botman 🎯\n\n" +
      "▶️ — testni shu yerda yechish\n" +
      "👥 Guruhda — botni guruhga qo'shib, testni o'sha yerda boshlash\n" +
      "⚙️ — shu chat uchun savol vaqti\n" +
      "👥 Mening guruhlarim — guruhlaringizni shu yerdan boshqarish: testlarni yoqish/o'chirish, vaqt, kim boshqaradi\n\n" +
      "Yordam: /help",
    { parse_mode: "HTML", reply_markup: kb },
  );
});

bot.command("quiz", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  if (!enabledOf(await getChat(ctx.chat.id))) return ctx.reply(DISABLED_TEXT);
  const id = ctx.match?.trim();
  if (id) return start(ctx.chat, id);
  await ctx.reply("Qaysi testni boshlaymiz?", { reply_markup: quizListKeyboard() });
});

bot.command("stop", async (ctx) => {
  if (!(await canManage(ctx.chat, ctx.from, ctx.msg.sender_chat))) return ctx.reply(NO_ACCESS);
  if (!(await stopAndReport(ctx, ctx.chat.id))) await ctx.reply("Hozir hech qanday test ketmayapti.");
});

bot.command("help", (ctx) =>
  ctx.reply(
    "<b>Buyruqlar</b>\n" +
      "/quiz — testlar ro'yxati\n" +
      "/quiz test_id — testni darhol boshlash\n" +
      "/stop — ketayotgan testni to'xtatish\n" +
      "/settings — sozlamalar\n" +
      "/groups — mening guruhlarim (shaxsiy chatda)\n" +
      "/time 25 — har bir savolga 25 soniya (5–600, masalan 2m = 2 daqiqa)\n" +
      "/manager — (guruhda, odamning xabariga javob qilib) testni boshqarish huquqini berish yoki olish\n\n" +
      "<b>Guruhlarni boshqarish</b>\nBotning shaxsiy chatida /groups. " +
      "U yerda har bir guruh uchun testlarni yoqish/o'chirish, savol vaqti, kamida necha kishi va kim boshqarishini tanlaysiz.\n\n" +
      "Guruhda test kamida belgilangan sondagi odam «✋ Men tayyorman» bosgach boshlanadi. " +
      "Savollar va variantlar har safar aralashtiriladi, oxirida reyting chiqadi.\n\n" +
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
  await start(chat, ctx.match[1]);
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
  const quiz = quizzes.get(session.quizId);
  await ctx
    .editMessageText(lobbyText({ quiz, ...session, names, countdown }), { parse_mode: "HTML", reply_markup: lobbyKeyboard() })
    .catch(() => {});
});

bot.callbackQuery("lobby:cancel", async (ctx) => {
  const session = ctx.chat && (await getSession(ctx.chat.id));
  if (!session || (session.phase !== "lobby" && session.phase !== "countdown")) return ctx.answerCallbackQuery();
  if (!(await canManage(ctx.chat, ctx.from))) return ctx.answerCallbackQuery({ text: NO_ACCESS, show_alert: true });
  await ctx.answerCallbackQuery({ text: "Bekor qilinmoqda..." });
  await stopAndReport(ctx, ctx.chat.id);
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

// "Bekor qilish" va "O'z vaqtim" javoblari
bot.on("message:text", async (ctx) => {
  if (ctx.chat.type === "private" && ctx.msg.text === "Bekor qilish") {
    await del(`await/mgr/${ctx.from.id}`);
    return ctx.reply("Bekor qilindi.", { reply_markup: { remove_keyboard: true } });
  }

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

bot.catch((err) => console.error("Xato:", err.error?.message ?? err));

// ---------- Netlify funksiyasi ----------

const handleUpdate = webhookCallback(bot, "std/http", { secretToken: SECRET, timeoutMilliseconds: 9000 });

export default async (req, context) => {
  if (!TOKEN || !SECRET) return new Response("BOT_TOKEN yoki WEBHOOK_SECRET sozlanmagan", { status: 500 });
  if (req.method !== "POST") return new Response("Linguify Quiz webhook ishlayapti ✅");
  SITE_URL = context?.site?.url || process.env.URL;
  return handleUpdate(req);
};
