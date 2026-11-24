// Fon funksiyasi (nomi "-background" bilan tugagani uchun 15 daqiqagacha ishlay oladi).
// Testni boshidan oxirigacha olib boradi: kutish xonasi -> savollar -> natijalar.
// 15 daqiqadan uzun testda o'zini yangi chaqiruv bilan davom ettiradi.
import {
  bot, SECRET, quizzes, LOBBY_TIMEOUT_MS, LOBBY_COUNTDOWN_S,
  getSession, setJSON, getText, del, delPrefix, listKeys, stopRequested, readyNames, invokeRunner,
  lobbyText, lobbyKeyboard, shuffle, sleep, esc, fmtTime,
} from "../../lib/core.js";

const BUDGET_MS = 12 * 60 * 1000; // har bir chaqiruvga ~12 daqiqa (Netlify chegarasi 15)

export default async (req, context) => {
  if (!SECRET || req.headers.get("x-runner-secret") !== SECRET) return new Response("forbidden", { status: 403 });
  const { chatId, runId, index = 0 } = await req.json();
  const siteUrl = context?.site?.url || process.env.URL;
  try {
    await run(chatId, runId, index, siteUrl);
  } catch (err) {
    console.error(`Runner xatosi (chat ${chatId}):`, err);
    await cleanup(chatId, runId).catch(() => {});
    await bot.api.sendMessage(chatId, "⚠️ Testda xatolik yuz berdi va u to'xtatildi.").catch(() => {});
  }
};

async function run(chatId, runId, index, siteUrl) {
  const deadline = Date.now() + BUDGET_MS;
  let s = await getSession(chatId);
  if (!s || s.runId !== runId) return;
  const quiz = quizzes.get(s.quizId);
  if (!quiz) return cleanup(chatId, runId);

  const save = async (patch) => {
    s = { ...s, ...patch, heartbeat: Date.now() };
    await setJSON(`session/${chatId}`, s);
  };
  const stillMine = async () => (await getSession(chatId))?.runId === runId;
  const continueLater = (i) => invokeRunner(siteUrl, { chatId, runId, index: i });

  /** Kutadi; "to'xtat" bosilsa true qaytaradi */
  const sleepOrStop = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await stopRequested(chatId, runId)) return true;
      await sleep(Math.min(2000, end - Date.now()));
    }
    return false;
  };

  const closeLobby = async (footer) => {
    const names = await readyNames(chatId, runId);
    const head = `🎯 <b>${esc(quiz.title)}</b>\n✋ Tayyor bo'lganlar: ${names.length ? names.map(esc).join(", ") : "—"}`;
    await bot.api.editMessageText(chatId, s.lobbyMsgId, head + footer, { parse_mode: "HTML" }).catch(() => {});
  };

  // ---------- 1. Kutish xonasi (guruhda) ----------
  if (s.phase === "lobby") {
    let lastBeat = Date.now();
    for (;;) {
      if (!(await stillMine())) return;
      if (await stopRequested(chatId, runId)) {
        await closeLobby("\n\n⏹ Test bekor qilindi.");
        return cleanup(chatId, runId);
      }
      if ((await readyNames(chatId, runId)).length >= s.min) break;
      if (Date.now() - s.startedAt > LOBBY_TIMEOUT_MS) {
        await closeLobby(`\n\n⌛ ${LOBBY_TIMEOUT_MS / 60000} daqiqa ichida yetarli odam yig'ilmadi — test bekor qilindi.`);
        return cleanup(chatId, runId);
      }
      if (Date.now() > deadline) return continueLater(index);
      if (Date.now() - lastBeat > 20000) {
        await save({});
        lastBeat = Date.now();
      }
      await sleep(2000);
    }

    await save({ phase: "countdown" });
    const names = await readyNames(chatId, runId);
    await bot.api
      .editMessageText(chatId, s.lobbyMsgId, lobbyText({ quiz, ...s, names, countdown: true }), {
        parse_mode: "HTML",
        reply_markup: lobbyKeyboard(),
      })
      .catch(() => {});
    if (await sleepOrStop(LOBBY_COUNTDOWN_S * 1000)) {
      await closeLobby("\n\n⏹ Test bekor qilindi.");
      return cleanup(chatId, runId);
    }
  }

  if (s.phase === "countdown") {
    const count = (await readyNames(chatId, runId)).length;
    await closeLobby(`\n\n▶️ <b>Boshlandi!</b> Ishtirokchilar: ${count}`);
    await save({ phase: "running", order: shuffle(quiz.questions.map((_, i) => i)) });
  }

  // ---------- 1b. Shaxsiy chat / kanal: qisqa kirish ----------
  if (s.phase === "intro") {
    await bot.api.sendMessage(
      chatId,
      `🎯 <b>${esc(quiz.title)}</b>\n` +
        (quiz.description ? `${esc(quiz.description)}\n` : "") +
        `\n📝 ${s.total} ta savol, har biriga ${fmtTime(s.time)}.\nTayyorlaning, 5 soniyadan keyin boshlanadi!`,
      { parse_mode: "HTML" },
    );
    if (await sleepOrStop(5000)) return stopped(chatId, runId, s);
    await save({ phase: "running", order: shuffle(quiz.questions.map((_, i) => i)) });
  }

  // ---------- 2. Savollar ----------
  for (let i = index; i < s.order.length; i++) {
    if (!(await stillMine())) return;
    if (await stopRequested(chatId, runId)) return stopped(chatId, runId, s);
    if (Date.now() + (s.time + 15) * 1000 > deadline) return continueLater(i);

    const q = quiz.questions[s.order[i]];
    const options = shuffle(q.options);
    const correct = options.indexOf(q.answer);
    const msg = await bot.api.sendPoll(chatId, `[${i + 1}/${s.order.length}] ${q.question}`, options.map((text) => ({ text })), {
      type: "quiz",
      correct_option_id: correct,
      is_anonymous: s.anonymous,
      open_period: s.time,
      explanation: q.explanation || undefined,
    });
    await setJSON(`poll/${msg.poll.id}`, { chatId, runId, correct, sentAt: Date.now() });
    await save({ lastPoll: msg.message_id, polls: [...(s.polls ?? []), msg.poll.id] });

    if (await sleepOrStop((s.time + 2) * 1000)) return stopped(chatId, runId, s);
  }

  // ---------- 3. Natijalar ----------
  await sleep(1500); // oxirgi javoblar yetib kelishi uchun
  await sendResults(chatId, runId, s, quiz);
  await cleanup(chatId, runId);
}

async function stopped(chatId, runId, s) {
  if (s.lastPoll) await bot.api.stopPoll(chatId, s.lastPoll).catch(() => {});
  await bot.api.sendMessage(chatId, "⏹ Test to'xtatildi.").catch(() => {});
  await cleanup(chatId, runId);
}

async function cleanup(chatId, runId) {
  const s = await getSession(chatId);
  if (s?.runId === runId) {
    await Promise.all((s.polls ?? []).map((id) => del(`poll/${id}`)));
    await del(`session/${chatId}`);
  }
  await Promise.all([
    delPrefix(`ready/${chatId}/${runId}/`),
    delPrefix(`ans/${chatId}/${runId}/`),
    delPrefix(`name/${chatId}/${runId}/`),
    del(`stop/${chatId}/${runId}`),
  ]);
}

// ---------- natijalar ----------

function fmtDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function chunkLines(lines, limit = 3800) {
  const chunks = [];
  let cur = "";
  for (const line of lines) {
    if (cur.length + line.length + 1 > limit) {
      chunks.push(cur);
      cur = "";
    }
    cur += (cur ? "\n" : "") + line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function sendResults(chatId, runId, s, quiz) {
  const title = esc(quiz.title);
  const total = s.order.length;

  if (s.anonymous) {
    await bot.api.sendMessage(chatId, `🏁 <b>${title}</b> tugadi!\n\nNatijalarni har bir savol ostida ko'rishingiz mumkin.`, { parse_mode: "HTML" });
    return;
  }

  // ans/<chat>/<run>/<uid>/<pollId>~<ok>~<ms>
  const players = new Map();
  for (const key of await listKeys(`ans/${chatId}/${runId}/`)) {
    const [uid, rest] = key.split("/").slice(3);
    const [, ok, ms] = rest.split("~");
    const p = players.get(uid) ?? { uid, correct: 0, ms: 0 };
    if (ok === "1") {
      p.correct++;
      p.ms += Number(ms);
    }
    players.set(uid, p);
  }
  await Promise.all([...players.values()].map(async (p) => (p.name = (await getText(`name/${chatId}/${runId}/${p.uid}`)) ?? "Ishtirokchi")));

  // Ko'p to'g'ri javob — yuqorida; teng bo'lsa, tezroq javob bergan — yuqorida
  const ranking = [...players.values()].sort((a, b) => b.correct - a.correct || a.ms - b.ms);
  if (ranking.length === 0) {
    await bot.api.sendMessage(chatId, `🏁 <b>${title}</b> tugadi!\n\nHech kim javob bermadi 🤷\nQaytadan: /quiz`, { parse_mode: "HTML" });
    return;
  }

  const pct = (p) => Math.round((p.correct / total) * 100);
  const mention = (p) => `<a href="tg://user?id=${p.uid}">${esc(p.name)}</a>`;

  // 1) G'oliblar — alohida xabar
  const podium = [["🥇", "1-o'rin"], ["🥈", "2-o'rin"], ["🥉", "3-o'rin"]];
  const winners = ranking
    .slice(0, 3)
    .map((p, i) => `${podium[i][0]} <b>${podium[i][1]}: ${mention(p)}</b>\n      ✅ ${p.correct}/${total} (${pct(p)}%) · ⏱ ${fmtDuration(p.ms)}`);
  await bot.api.sendMessage(chatId, `🏁 <b>${title}</b> tugadi!\n\n🏆🏆🏆 <b>G'OLIBLAR</b> 🏆🏆🏆\n\n${winners.join("\n\n")}\n\n🎉 Tabriklaymiz!`, {
    parse_mode: "HTML",
  });

  // 2) Barcha ishtirokchilar reytingi
  const medal = ["🥇", "🥈", "🥉"];
  const lines = ranking.map((p, i) => {
    const row = `${medal[i] ?? `<b>${i + 1}.</b>`} ${esc(p.name)} — ${p.correct}/${total} (${pct(p)}%) · ⏱ ${fmtDuration(p.ms)}`;
    return i < 3 ? `<b>${row}</b>` : row;
  });
  const header = `📊 <b>Umumiy reyting</b> — ${title}\n👥 Ishtirokchilar: ${ranking.length} · 📝 Savollar: ${total}\n`;
  const footer = `\n<i>⏱ — to'g'ri javoblarga ketgan umumiy vaqt. Teng ball bo'lsa, tezroq javob bergan yuqorida turadi.</i>\nQaytadan: /quiz`;

  let firstId = null;
  for (const text of chunkLines([header, ...lines, footer])) {
    const sent = await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    firstId ??= sent.message_id;
  }
  if (s.chatType !== "private") await bot.api.pinChatMessage(chatId, firstId, { disable_notification: true }).catch(() => {});
}
