// Test yaratish (/newquiz, ko'p savol, /vocab), /mytests, ulashish havolalari, /practice
import { InlineKeyboard } from "grammy";
import { bot, quizzes, getJSON, setJSON, del, listKeys, esc, trunc, botUsername, startQuiz, shuffle } from "./core.js";
import { parseBulk, parseVocab, makeVocabQuestions, clip, cleanText, MAX_Q, MAX_OPT, MAX_EXP, MAX_QUESTIONS } from "./parse.js";
import { getUser } from "./stats.js";

const MAX_QUIZZES_PER_USER = 30;
const stateKey = (uid) => `await/nq/${uid}`;
const getState = (uid) => getJSON(stateKey(uid));
const setState = (uid, st) => setJSON(stateKey(uid), st);
const clearState = (uid) => del(stateKey(uid));

const newId = () => "u" + Math.random().toString(36).slice(2, 9);
const isPrivate = (ctx) => ctx.chat?.type === "private";

const QUESTION_HELP =
  "Savollarni ikki usulda yuborishingiz mumkin:\n\n" +
  "<b>1️⃣ Quiz so'rovnomasi:</b> 📎 → <b>Poll</b> → <b>Quiz mode</b> ni yoqing, savol va variantlarni yozib, to'g'ri javobni belgilang va menga yuboring. " +
  "Tayyor quiz'larni (masalan @QuizBot'dan) menga <b>forward</b> ham qilsangiz bo'ladi.\n\n" +
  "<b>2️⃣ Matn bilan, bir yoki ko'p savol bir xabarda:</b>\n" +
  "<pre>1. I ___ a student.\nA) am\nB) is\nC) are\nJavob: A\nIzoh: I bilan am ishlatiladi\n\n2. She ___ happy.\nA) am\nB) is ✅\nC) are</pre>\n" +
  "To'g'ri variantni <code>Javob: B</code> deb yoki variant oxiriga ✅ qo'yib belgilang.\n\n" +
  "Tugatish: /done · Oxirgisini o'chirish: /undo · Bekor qilish: /cancel";

// ---------- yordamchi ----------

async function userQuizzes(uid) {
  const keys = await listKeys(`uq/${uid}/`);
  const items = await Promise.all(keys.map(async (k) => ({ id: k.split("/")[2], ...(await getJSON(k)) })));
  return items.filter((x) => x.title).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
}

async function saveIndex(quiz) {
  await setJSON(`uq/${quiz.owner}/${quiz.id}`, { title: quiz.title, n: quiz.questions.length, ts: quiz.createdAt ?? Date.now() });
}

async function quizCard(quiz, heading) {
  const uname = await botUsername();
  const kb = new InlineKeyboard()
    .text("▶️ Yakka boshlash", `start:${quiz.id}`)
    .url("👥 Guruhda", `https://t.me/${uname}?startgroup=${quiz.id}`)
    .row()
    .text("⚙️ Boshqarish", `q:${quiz.id}`)
    .text("📋 Testlarim", "q:l");
  const text =
    `${heading}\n\n🎯 <b>${esc(quiz.title)}</b>\n📝 ${quiz.questions.length} ta savol\n\n` +
    `🔗 <b>Ulashish havolasi:</b>\nhttps://t.me/${uname}?start=${quiz.id}\n<i>Havolani bosgan odamda test ochiladi.</i>`;
  return { text, kb };
}

function pollToQuestion(poll) {
  if (poll.type !== "quiz") return { error: "Bu oddiy so'rovnoma. Iltimos, <b>Quiz mode</b> yoqilgan so'rovnoma yuboring." };
  if (poll.correct_option_id === undefined || poll.correct_option_id === null) {
    return { error: "To'g'ri javob ko'rinmayapti. So'rovnomani to'g'ridan-to'g'ri menga yarating yoki forward qiling." };
  }
  const options = poll.options.map((o) => cleanText(o.text));
  if (options.some((o) => o.length > MAX_OPT)) return { error: `Variant ${MAX_OPT} belgidan uzun.` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: "Bir xil variantlar bor." };
  return {
    q: {
      question: clip(cleanText(poll.question), MAX_Q),
      options,
      answer: options[poll.correct_option_id],
      explanation: poll.explanation ? clip(cleanText(poll.explanation), MAX_EXP) : null,
    },
  };
}

async function addQuestions(ctx, st, qs, errors = []) {
  const room = MAX_QUESTIONS - (st.questions.length + (st.existing ?? 0));
  const take = qs.slice(0, Math.max(room, 0));
  st.questions.push(...take);
  await setState(ctx.from.id, st);
  let t = take.length ? `✅ <b>${take.length}</b> ta savol qo'shildi. Jami: <b>${st.questions.length}</b>.` : "";
  if (qs.length > take.length) t += `\n⚠️ Bitta testda ${MAX_QUESTIONS} tadan ortiq savol bo'lmaydi.`;
  if (errors.length) t += `${t ? "\n\n" : ""}⚠️ <b>O'tkazib yuborildi:</b>\n${errors.slice(0, 8).map((e) => `• ${esc(e)}`).join("\n")}`;
  t += `\n\nDavom eting yoki tugatish uchun /done yuboring.`;
  await ctx.reply(t, { parse_mode: "HTML" });
}

// ---------- boshlash buyruqlari ----------

async function startNew(ctx) {
  if (!isPrivate(ctx)) return ctx.reply("Test yaratish uchun menga shaxsiy chatda yozing: /newquiz");
  const mine = await userQuizzes(ctx.from.id);
  if (mine.length >= MAX_QUIZZES_PER_USER) return ctx.reply(`Sizda ${MAX_QUIZZES_PER_USER} ta test bor — bu chegara. Keraksizlarini /mytests dan o'chiring.`);
  await setState(ctx.from.id, { mode: "new", step: "title", questions: [] });
  await ctx.reply("📝 <b>Yangi test</b>\n\nAvval test <b>nomini</b> yuboring (masalan: <i>Present Simple — 1</i>).\nBekor qilish: /cancel", { parse_mode: "HTML" });
}

async function startVocab(ctx) {
  if (!isPrivate(ctx)) return ctx.reply("Lug'at testi yaratish uchun menga shaxsiy chatda yozing: /vocab");
  const mine = await userQuizzes(ctx.from.id);
  if (mine.length >= MAX_QUIZZES_PER_USER) return ctx.reply(`Sizda ${MAX_QUIZZES_PER_USER} ta test bor — bu chegara. Keraksizlarini /mytests dan o'chiring.`);
  await setState(ctx.from.id, { mode: "vocab", step: "title", pairs: [] });
  await ctx.reply("📚 <b>Lug'at testi</b>\n\nAvval test <b>nomini</b> yuboring (masalan: <i>Unit 3 lug'ati</i>).\nBekor qilish: /cancel", { parse_mode: "HTML" });
}

async function showMyTests(ctx, edit = false) {
  const mine = await userQuizzes(ctx.from.id);
  const kb = new InlineKeyboard();
  for (const q of mine) kb.text(`🎯 ${trunc(q.title, 32)} (${q.n})`, `q:${q.id}`).row();
  kb.text("➕ Yangi test", "q:new").text("📚 Lug'at testi", "q:vocab");
  const text = mine.length
    ? `📋 <b>Mening testlarim</b> (${mine.length}/${MAX_QUIZZES_PER_USER})\n\nBoshqarish uchun testni tanlang:`
    : "📋 <b>Mening testlarim</b>\n\nHozircha testingiz yo'q. ➕ tugmasi bilan yarating.";
  if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

// ---------- test kartochkasi (/mytests ichida) ----------

async function ownQuiz(ctx, id) {
  const quiz = await getJSON(`quiz/${id}`);
  if (!quiz || quiz.owner !== ctx.from.id) {
    await ctx.answerCallbackQuery({ text: "Test topilmadi.", show_alert: true });
    return null;
  }
  return quiz;
}

async function showQuizAdmin(ctx, quiz, edit = true) {
  const uname = await botUsername();
  const kb = new InlineKeyboard()
    .text("▶️ Yakka boshlash", `start:${quiz.id}`)
    .url("👥 Guruhda", `https://t.me/${uname}?startgroup=${quiz.id}`)
    .row()
    .text("➕ Savol qo'shish", `q:${quiz.id}:ad`)
    .text("📋 Savollar", `q:${quiz.id}:qs:0`)
    .row()
    .text("✏️ Nomini o'zgartirish", `q:${quiz.id}:rn`)
    .text("📑 Nusxa olish", `q:${quiz.id}:cp`)
    .row()
    .text("🗑 O'chirish", `q:${quiz.id}:dl`)
    .text("⬅️ Orqaga", "q:l");
  const text =
    `🎯 <b>${esc(quiz.title)}</b>\n📝 ${quiz.questions.length} ta savol\n\n🔗 <b>Havola:</b>\nhttps://t.me/${uname}?start=${quiz.id}`;
  if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } }).catch(() => {});
  else await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
}

async function showQuestions(ctx, quiz, page) {
  const per = 15;
  const pages = Math.max(1, Math.ceil(quiz.questions.length / per));
  page = Math.min(Math.max(page, 0), pages - 1);
  const slice = quiz.questions.slice(page * per, page * per + per);
  let text = `📋 <b>${esc(quiz.title)}</b> — savollar (${page + 1}/${pages})\n\n`;
  text += slice.map((q, i) => `${page * per + i + 1}. ${esc(trunc(q.question, 60))} → <b>${esc(trunc(q.answer, 25))}</b>`).join("\n");
  text += "\n\n<i>O'chirish uchun savol raqamini bosing:</i>";
  const kb = new InlineKeyboard();
  slice.forEach((_, i) => {
    kb.text(`🗑 ${page * per + i + 1}`, `q:${quiz.id}:dq:${page * per + i}`);
    if (i % 5 === 4) kb.row();
  });
  kb.row();
  if (page > 0) kb.text("◀️", `q:${quiz.id}:qs:${page - 1}`);
  kb.text("⬅️ Orqaga", `q:${quiz.id}`);
  if (page < pages - 1) kb.text("▶️", `q:${quiz.id}:qs:${page + 1}`);
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb }).catch(() => {});
}

// ---------- ro'yxatdan o'tkazish ----------

export function registerWizard(bot) {
  bot.command("newquiz", startNew);
  bot.command("vocab", startVocab);
  bot.command("mytests", async (ctx) => {
    if (!isPrivate(ctx)) return ctx.reply("Testlaringizni ko'rish uchun menga shaxsiy chatda yozing: /mytests");
    await showMyTests(ctx);
  });

  bot.command("practice", async (ctx) => {
    if (!isPrivate(ctx)) return ctx.reply("Yakka mashq uchun menga shaxsiy chatda yozing: /practice");
    const kb = new InlineKeyboard();
    for (const q of quizzes.values()) kb.text(`▶️ ${q.title}`, `start:${q.id}`).row();
    for (const q of await userQuizzes(ctx.from.id)) kb.text(`▶️ ${trunc(q.title, 32)}`, `start:${q.id}`).row();
    const u = await getUser(ctx.from.id);
    if (u.wrong.length) kb.text(`🔁 Xatolar ustida ishlash (${Math.min(u.wrong.length, 10)})`, "mx").row();
    await ctx.reply("🎯 <b>Yakka mashq</b>\n\nQaysi testni yechamiz?", { parse_mode: "HTML", reply_markup: kb });
  });

  bot.command("skip", async (ctx) => {
    const st = isPrivate(ctx) && (await getState(ctx.from.id));
    if (!st || st.step !== "desc") return ctx.reply("Hozir o'tkazib yuboradigan narsa yo'q.");
    st.step = "questions";
    await setState(ctx.from.id, st);
    await ctx.reply(`Yaxshi. Endi savollarni qo'shamiz.\n\n${QUESTION_HELP}`, { parse_mode: "HTML" });
  });

  bot.command("cancel", async (ctx) => {
    if (!isPrivate(ctx)) return;
    const st = await getState(ctx.from.id);
    await clearState(ctx.from.id);
    await ctx.reply(st ? "❌ Bekor qilindi." : "Hozir bekor qiladigan narsa yo'q.");
  });

  bot.command("undo", async (ctx) => {
    const st = isPrivate(ctx) && (await getState(ctx.from.id));
    if (!st?.questions?.length) return ctx.reply("O'chiradigan savol yo'q.");
    const q = st.questions.pop();
    await setState(ctx.from.id, st);
    await ctx.reply(`↩️ O'chirildi: ${esc(trunc(q.question, 60))}\nJami: ${st.questions.length} ta savol.`, { parse_mode: "HTML" });
  });

  bot.command("done", async (ctx) => {
    const st = isPrivate(ctx) && (await getState(ctx.from.id));
    if (!st || st.step !== "questions") return ctx.reply("Hozir tugatiladigan test yo'q. Yangi test: /newquiz");
    if (!st.questions.length) return ctx.reply("Hali birorta savol qo'shilmagan. Avval savol yuboring.");

    let quiz;
    if (st.mode === "add") {
      quiz = await getJSON(`quiz/${st.quizId}`);
      if (!quiz || quiz.owner !== ctx.from.id) {
        await clearState(ctx.from.id);
        return ctx.reply("Test topilmadi.");
      }
      quiz.questions.push(...st.questions);
    } else {
      quiz = {
        id: newId(), owner: ctx.from.id, title: st.title, description: st.description ?? "", createdAt: Date.now(), questions: st.questions,
      };
    }
    await setJSON(`quiz/${quiz.id}`, quiz);
    await saveIndex(quiz);
    await clearState(ctx.from.id);
    const { text, kb } = await quizCard(quiz, st.mode === "add" ? "✅ <b>Savollar qo'shildi</b>" : "✅ <b>Test saqlandi</b>");
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
  });

  // Quiz so'rovnomasi yuborilganda
  bot.on("message:poll", async (ctx, next) => {
    if (!isPrivate(ctx)) return next();
    const st = await getState(ctx.from.id);
    if (!st || st.step !== "questions") return next();
    const r = pollToQuestion(ctx.msg.poll);
    if (r.error) return ctx.reply(`⚠️ ${r.error}`, { parse_mode: "HTML" });
    await addQuestions(ctx, st, [r.q]);
  });

  // Lug'at yo'nalishi
  bot.callbackQuery(/^vc:([wtb])$/, async (ctx) => {
    const st = await getState(ctx.from.id);
    if (!st || st.mode !== "vocab" || st.step !== "pairs") return ctx.answerCallbackQuery({ text: "Bu amal eskirgan.", show_alert: true });
    if (st.pairs.length < 3) return ctx.answerCallbackQuery({ text: "Kamida 3 ta so'z juftligi kerak.", show_alert: true });
    const questions = makeVocabQuestions(st.pairs, ctx.match[1]);
    if (!questions.length) return ctx.answerCallbackQuery({ text: "Savol yasab bo'lmadi.", show_alert: true });
    await ctx.answerCallbackQuery();
    const quiz = { id: newId(), owner: ctx.from.id, title: st.title, description: "", createdAt: Date.now(), questions };
    await setJSON(`quiz/${quiz.id}`, quiz);
    await saveIndex(quiz);
    await clearState(ctx.from.id);
    const { text, kb } = await quizCard(quiz, "✅ <b>Lug'at testi tayyor</b>");
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
  });

  // /mytests tugmalari
  bot.callbackQuery("q:new", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startNew(ctx);
  });
  bot.callbackQuery("q:vocab", async (ctx) => {
    await ctx.answerCallbackQuery();
    await startVocab(ctx);
  });
  bot.callbackQuery("q:l", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMyTests(ctx, true);
  });

  bot.callbackQuery(/^q:([\w-]+?)(?::(\w+)(?::(\d+))?)?$/, async (ctx) => {
    const [, id, action, arg] = ctx.match;
    const quiz = await ownQuiz(ctx, id);
    if (!quiz) return;
    switch (action) {
      case undefined:
        await ctx.answerCallbackQuery();
        return showQuizAdmin(ctx, quiz);
      case "qs":
        await ctx.answerCallbackQuery();
        return showQuestions(ctx, quiz, Number(arg ?? 0));
      case "dq": {
        const i = Number(arg);
        if (quiz.questions.length <= 1) return ctx.answerCallbackQuery({ text: "Oxirgi savolni o'chirib bo'lmaydi. Testni to'liq o'chirishingiz mumkin.", show_alert: true });
        if (!quiz.questions[i]) return ctx.answerCallbackQuery();
        quiz.questions.splice(i, 1);
        await setJSON(`quiz/${quiz.id}`, quiz);
        await saveIndex(quiz);
        await ctx.answerCallbackQuery({ text: "Savol o'chirildi" });
        return showQuestions(ctx, quiz, Math.floor(i / 15));
      }
      case "ad":
        await ctx.answerCallbackQuery();
        await setState(ctx.from.id, { mode: "add", step: "questions", quizId: quiz.id, existing: quiz.questions.length, questions: [] });
        return ctx.reply(`➕ <b>${esc(quiz.title)}</b> testiga savol qo'shamiz.\n\n${QUESTION_HELP}`, { parse_mode: "HTML" });
      case "rn":
        await ctx.answerCallbackQuery();
        await setState(ctx.from.id, { mode: "rename", step: "rename", quizId: quiz.id });
        return ctx.reply("✏️ Testning yangi nomini yuboring. Bekor qilish: /cancel");
      case "cp": {
        const mine = await userQuizzes(ctx.from.id);
        if (mine.length >= MAX_QUIZZES_PER_USER) return ctx.answerCallbackQuery({ text: "Testlar chegarasiga yetdingiz.", show_alert: true });
        const copy = { ...quiz, id: newId(), title: trunc(`${quiz.title} (nusxa)`, 100), createdAt: Date.now() };
        await setJSON(`quiz/${copy.id}`, copy);
        await saveIndex(copy);
        await ctx.answerCallbackQuery({ text: "Nusxa olindi" });
        return showQuizAdmin(ctx, copy);
      }
      case "dl":
        await ctx.answerCallbackQuery();
        return ctx.editMessageText(`🗑 <b>${esc(quiz.title)}</b> testini o'chirasizmi?\nBu amalni qaytarib bo'lmaydi.`, {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("🗑 Ha, o'chirish", `q:${quiz.id}:dy`).text("Yo'q", `q:${quiz.id}`),
        });
      case "dy":
        await del(`quiz/${quiz.id}`);
        await del(`uq/${ctx.from.id}/${quiz.id}`);
        await ctx.answerCallbackQuery({ text: "Test o'chirildi" });
        return showMyTests(ctx, true);
    }
    return ctx.answerCallbackQuery();
  });
}

// ---------- matnli javoblar (savol, nom, tavsif, lug'at) ----------

/** Shaxsiy chatda wizard kutayotgan bo'lsa matnni qayta ishlaydi; qayta ishlansa true. */
export async function handleWizardText(ctx) {
  if (!isPrivate(ctx) || !ctx.from) return false;
  const text = ctx.msg.text;
  if (text.startsWith("/")) return false;
  const st = await getState(ctx.from.id);
  if (!st) return false;

  if (st.step === "rename") {
    const quiz = await getJSON(`quiz/${st.quizId}`);
    if (!quiz || quiz.owner !== ctx.from.id) {
      await clearState(ctx.from.id);
      await ctx.reply("Test topilmadi.");
      return true;
    }
    quiz.title = clip(cleanText(text), 100);
    await setJSON(`quiz/${quiz.id}`, quiz);
    await saveIndex(quiz);
    await clearState(ctx.from.id);
    await ctx.reply(`✅ Yangi nom: <b>${esc(quiz.title)}</b>`, { parse_mode: "HTML" });
    await showQuizAdmin(ctx, quiz, false);
    return true;
  }

  if (st.step === "title") {
    st.title = clip(cleanText(text), 100);
    if (st.mode === "vocab") {
      st.step = "pairs";
      await setState(ctx.from.id, st);
      await ctx.reply(
        `Nom: <b>${esc(st.title)}</b>\n\nEndi so'zlarni yuboring, har bir qatorda bittadan:\n<pre>apple - olma\nbook - kitob\nhouse - uy</pre>\n` +
          "Kamida 3 ta juftlik kerak. Bir necha xabar yuborsangiz bo'ladi. Tayyor bo'lgach yo'nalishni tanlang. Bekor qilish: /cancel",
        { parse_mode: "HTML" },
      );
    } else {
      st.step = "desc";
      await setState(ctx.from.id, st);
      await ctx.reply(`Nom: <b>${esc(st.title)}</b>\n\nEndi qisqa <b>tavsif</b> yuboring yoki /skip bosing.`, { parse_mode: "HTML" });
    }
    return true;
  }

  if (st.step === "desc") {
    st.description = clip(cleanText(text), 200);
    st.step = "questions";
    await setState(ctx.from.id, st);
    await ctx.reply(`Tavsif saqlandi.\n\n${QUESTION_HELP}`, { parse_mode: "HTML" });
    return true;
  }

  if (st.step === "questions") {
    const { questions, errors } = parseBulk(text);
    if (!questions.length && !errors.length) {
      await ctx.reply("Savol topilmadi. Namuna formatga qarang:\n\n<pre>1. Savol?\nA) variant\nB) variant\nJavob: A</pre>", { parse_mode: "HTML" });
      return true;
    }
    await addQuestions(ctx, st, questions, errors);
    return true;
  }

  if (st.step === "pairs") {
    const { pairs, bad } = parseVocab(text);
    if (!pairs.length) {
      await ctx.reply("Juftlik topilmadi. Har qatorda: <code>so'z - tarjima</code>", { parse_mode: "HTML" });
      return true;
    }
    const seen = new Set(st.pairs.map((p) => p.w.toLowerCase()));
    const fresh = pairs.filter((p) => !seen.has(p.w.toLowerCase()));
    st.pairs.push(...fresh);
    st.pairs = st.pairs.slice(0, 100);
    await setState(ctx.from.id, st);
    const kb = new InlineKeyboard()
      .text("So'z → tarjima", "vc:w")
      .text("Tarjima → so'z", "vc:t")
      .row()
      .text("Ikkalasi ham", "vc:b");
    await ctx.reply(
      `✅ Jami <b>${st.pairs.length}</b> ta juftlik${bad ? ` (${bad} qator o'tkazib yuborildi)` : ""}.\n` +
        (st.pairs.length < 3 ? "Kamida 3 ta kerak, yana yuboring." : "Yana yuborishingiz mumkin yoki savol yo'nalishini tanlang:"),
      { parse_mode: "HTML", reply_markup: kb },
    );
    return true;
  }
  return false;
}
