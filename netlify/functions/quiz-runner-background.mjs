// Fon funksiyasi (nomi "-background" bilan tugagani uchun 15 daqiqagacha ishlay oladi).
// Testni boshidan oxirigacha olib boradi: kutish xonasi -> savollar -> natijalar.
// 15 daqiqadan uzun testda o'zini yangi chaqiruv bilan davom ettiradi.
import {
  bot, SECRET, LOBBY_TIMEOUT_MS,
  getSession, setJSON, getText, setText, del, delPrefix, stopRequested, readyNames, invokeRunner, setSiteUrl,
  lobbyText, lobbyKeyboard, shuffle, sleep, esc, fmtTime,
} from "../../lib/core.js";
import { finishSession } from "../../lib/results.js";
import { reportError } from "../../lib/admin.js";

const BUDGET_MS = 12 * 60 * 1000; // har bir chaqiruvga ~12 daqiqa (Netlify chegarasi 15)
const MAX_PAUSE_MS = 30 * 60 * 1000; // pauza 30 daqiqadan oshsa — o'zi davom etadi

export default async (req, context) => {
  if (!SECRET || req.headers.get("x-runner-secret") !== SECRET) return new Response("forbidden", { status: 403 });
  setSiteUrl(new URL(req.url).origin);
  const { chatId, runId, index = 0 } = await req.json();
  try {
    await run(chatId, runId, index);
  } catch (err) {
    await reportError("runner", err, `chat ${chatId}`);
    await cleanup(chatId, runId).catch(() => {});
    await bot.api.sendMessage(chatId, "⚠️ Testda xatolik yuz berdi va u to'xtatildi.").catch(() => {});
  }
};

async function run(chatId, runId, index) {
  const deadline = Date.now() + BUDGET_MS;
  let s = await getSession(chatId);
  if (!s || s.runId !== runId) return;

  const save = async (patch) => {
    s = { ...s, ...patch, heartbeat: Date.now() };
    await setJSON(`session/${chatId}`, s);
  };
  const stillMine = async () => (await getSession(chatId))?.runId === runId;
  const continueLater = (i) => invokeRunner({ chatId, runId, index: i });
  const flagKey = (name) => `${name}/${chatId}/${runId}`;

  /** Kutadi. Natija: "stop" | "flag" (belgi qo'yilgan) | null (vaqt tugadi) */
  const sleepOrStop = async (ms, flag, step = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await stopRequested(chatId, runId)) return "stop";
      if (flag && (await getText(flagKey(flag))) !== null) return "flag";
      await sleep(Math.min(step, end - Date.now()));
    }
    return null;
  };

  const closeLobby = async (footer) => {
    const names = await readyNames(chatId, runId);
    const head = `🎯 <b>${esc(s.title)}</b>\n✋ Tayyor bo'lganlar: ${names.length ? names.map(esc).join(", ") : "—"}`;
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
      .editMessageText(chatId, s.lobbyMsgId, lobbyText({ ...s, names, countdown: true }), { parse_mode: "HTML", reply_markup: lobbyKeyboard() })
      .catch(() => {});
    // "Hozir boshlash" bosilsa sanoq to'xtaydi
    if ((await sleepOrStop(s.cd * 1000, "start", 1000)) === "stop") {
      await closeLobby("\n\n⏹ Test bekor qilindi.");
      return cleanup(chatId, runId);
    }
  }

  if (s.phase === "countdown") {
    const count = (await readyNames(chatId, runId)).length;
    await closeLobby(`\n\n▶️ <b>Boshlandi!</b> Ishtirokchilar: ${count}`);
    await save({ phase: "running" });
  }

  // ---------- 1b. Shaxsiy chat / kanal: qisqa kirish ----------
  if (s.phase === "intro") {
    await bot.api.sendMessage(
      chatId,
      `🎯 <b>${esc(s.title)}</b>\n` +
        (s.description ? `${esc(s.description)}\n` : "") +
        `\n📝 ${s.total} ta savol, har biriga ${fmtTime(s.time)}.\nTayyorlaning, 5 soniyadan keyin boshlanadi!`,
      { parse_mode: "HTML" },
    );
    if ((await sleepOrStop(5000)) === "stop") return stopped(chatId, runId, s);
    await save({ phase: "running" });
  }

  // ---------- 2. Savollar ----------
  for (let i = index; i < s.questions.length; i++) {
    if (!(await stillMine())) return;
    if (await stopRequested(chatId, runId)) return stopped(chatId, runId, s);

    // Pauza: /resume bosilguncha kutadi
    if ((await getText(flagKey("pause"))) !== null) {
      const pausedAt = Date.now();
      let beat = Date.now();
      while ((await getText(flagKey("pause"))) !== null) {
        if (await stopRequested(chatId, runId)) return stopped(chatId, runId, s);
        if (Date.now() - pausedAt > MAX_PAUSE_MS) {
          await del(flagKey("pause"));
          await bot.api.sendMessage(chatId, "▶️ Pauza 30 daqiqadan oshdi — test o'zi davom etmoqda.").catch(() => {});
          break;
        }
        if (Date.now() > deadline) return continueLater(i);
        if (Date.now() - beat > 20000) {
          await save({});
          beat = Date.now();
        }
        await sleep(2000);
      }
    }

    if (Date.now() + (s.time + s.gap + 15) * 1000 > deadline) return continueLater(i);

    const q = s.questions[i];
    const options = s.shuffleO ? shuffle(q.options) : q.options;
    const correct = options.indexOf(q.answer);
    const msg = await bot.api.sendPoll(chatId, `[${i + 1}/${s.questions.length}] ${q.question}`, options.map((text) => ({ text })), {
      type: "quiz",
      correct_option_id: correct,
      is_anonymous: s.anonymous,
      open_period: s.time,
      explanation: q.explanation || undefined,
    });
    await setJSON(`poll/${msg.poll.id}`, { chatId, runId, correct, sentAt: Date.now() });
    await save({ lastPoll: msg.message_id, polls: [...(s.polls ?? []), msg.poll.id], pollQ: { ...(s.pollQ ?? {}), [msg.poll.id]: i } });

    if ((await sleepOrStop((s.time + s.gap) * 1000)) === "stop") return stopped(chatId, runId, s);
  }

  // ---------- 3. Natijalar ----------
  await sleep(1500); // oxirgi javoblar yetib kelishi uchun
  await finishSession(chatId, runId, s);
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
    del(`pause/${chatId}/${runId}`),
    del(`start/${chatId}/${runId}`),
  ]);
}
