// Test tugagach: reyting, g'oliblar, shaxsiy kartochkalar, statistika, hisobot va eslatmalar
import { InlineKeyboard } from "grammy";
import {
  bot, getText, getJSON, setJSON, listKeys, esc, trunc, dm, fmtDuration, isGroupType, tashDay, LOW_SCORE_PCT,
} from "./core.js";
import { updateUserAfterSession } from "./stats.js";
import { reportError } from "./admin.js";

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

/** Saqlangan javoblarni o'qiydi: ishtirokchilar va har bir savol bo'yicha to'g'ri/xato soni */
async function collect(chatId, runId, s) {
  const players = new Map();
  const perPoll = new Map();
  for (const key of await listKeys(`ans/${chatId}/${runId}/`)) {
    const [uid, rest] = key.split("/").slice(3);
    const [pollId, ok, ms] = rest.split("~");
    const qi = s.pollQ?.[pollId];
    const p = players.get(uid) ?? { uid, name: "", correct: 0, ms: 0, perQ: {} };
    if (ok === "1") {
      p.correct++;
      p.ms += Number(ms);
    }
    if (qi !== undefined) p.perQ[qi] = ok === "1" ? 1 : 0;
    players.set(uid, p);
    const pp = perPoll.get(pollId) ?? { right: 0, wrong: 0 };
    if (ok === "1") pp.right++;
    else pp.wrong++;
    perPoll.set(pollId, pp);
  }
  await Promise.all([...players.values()].map(async (p) => (p.name = (await getText(`name/${chatId}/${runId}/${p.uid}`)) ?? "Ishtirokchi")));
  return { players, perPoll };
}

export async function finishSession(chatId, runId, s) {
  const total = s.questions.length;
  const title = esc(s.title);

  if (s.anonymous) {
    await bot.api.sendMessage(chatId, `🏁 <b>${title}</b> tugadi!\n\nNatijalarni har bir savol ostida ko'rishingiz mumkin.`, { parse_mode: "HTML" });
    return;
  }

  const { players, perPoll } = await collect(chatId, runId, s);
  // Ko'p to'g'ri javob — yuqorida; teng bo'lsa, tezroq javob bergan — yuqorida
  const ranking = [...players.values()].sort((a, b) => b.correct - a.correct || a.ms - b.ms);

  if (!ranking.length) {
    await bot.api.sendMessage(chatId, `🏁 <b>${title}</b> tugadi!\n\nHech kim javob bermadi 🤷\nQaytadan: /quiz`, { parse_mode: "HTML" });
    return;
  }

  const isPrivate = s.chatType === "private";
  if (!isPrivate) await sendRanking(chatId, s, ranking, total);

  try {
    await afterResults(chatId, s, ranking, perPoll, total, isPrivate);
  } catch (e) {
    await reportError("results", e, `chat ${chatId}`);
  }
}

async function sendRanking(chatId, s, ranking, total) {
  const title = esc(s.title);
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
  const footer =
    `\n<i>⏱ — to'g'ri javoblarga ketgan umumiy vaqt. Teng ball bo'lsa, tezroq javob bergan yuqorida turadi.</i>\n` +
    `📩 <i>Shaxsiy natija va xatolar tahlili botning shaxsiy chatiga yuboriladi (botga bir marta /start bosgan bo'lsangiz).</i>\n` +
    `Qaytadan: /quiz`;

  let firstId = null;
  for (const text of chunkLines([header, ...lines, footer])) {
    const sent = await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    firstId ??= sent.message_id;
  }
  if (s.pin && s.chatType !== "private") await bot.api.pinChatMessage(chatId, firstId, { disable_notification: true }).catch(() => {});
}

// ---------- shaxsiy kartochka ----------

function buildCard(s, p, rank, nPlayers, total, user, newBadges, wrongItems) {
  const pct = Math.round((p.correct / total) * 100);
  let t = `📊 <b>Natijangiz</b> — ${esc(s.title)}\n\n`;
  t += `✅ <b>${p.correct}/${total}</b> (${pct}%) · ⏱ ${fmtDuration(p.ms)}`;
  if (nPlayers > 1) t += ` · 🏅 ${rank}-o'rin (${nPlayers} kishidan)`;
  t += `\n🔥 Seriya: <b>${user.streak} kun</b>\n`;
  if (newBadges.length) t += `\n🎉 <b>Yangi nishon:</b> ${newBadges.join(", ")}\n`;
  if (s.kind !== "mistakes" && pct < LOW_SCORE_PCT) t += `\n💪 Natija biroz past. Xatolar ustida ishlasangiz, tez yaxshilanadi!\n`;

  if (wrongItems.length) {
    t += `\n❌ <b>Xato javoblar (${wrongItems.length})</b>:\n`;
    let body = "";
    for (const w of wrongItems.slice(0, 8)) {
      body += `• ${esc(trunc(w.q.question, 110))}\n   ✅ <b>${esc(trunc(w.q.answer, 60))}</b>${w.q.explanation ? ` — <i>${esc(trunc(w.q.explanation, 100))}</i>` : ""}\n`;
    }
    if (wrongItems.length > 8) body += `… va yana ${wrongItems.length - 8} ta\n`;
    t += body;
  }
  return trunc(t, 4000);
}

async function afterResults(chatId, s, ranking, perPoll, total, isPrivate) {
  const stats = (await getJSON("meta/stats")) ?? { tests: 0 };
  stats.tests = (stats.tests ?? 0) + (s.kind === "mistakes" ? 0 : 1);
  stats.lastTest = Date.now();
  await setJSON("meta/stats", stats);

  const queue = ranking.map((p, i) => ({ p, rank: i + 1 }));
  const lowReport = [];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { p, rank } = job;
      try {
        const wrongItems = [];
        const fixed = [];
        for (const [qi, ok] of Object.entries(p.perQ)) {
          const q = s.questions[Number(qi)];
          if (!q) continue;
          if (ok === 0) wrongItems.push({ key: q.key, q: { key: q.key, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation } });
          else fixed.push(q.key);
        }
        const pct = Math.round((p.correct / total) * 100);
        if (pct < LOW_SCORE_PCT) lowReport.push(p.name);

        const { u, newBadges } = await updateUserAfterSession(p.uid, p.name, {
          kind: s.kind, title: s.title, correct: p.correct, total, pct, rank, players: ranking.length, wrong: wrongItems, fixed,
        });

        const kb = new InlineKeyboard();
        if (u.wrong.length) kb.text(`🔁 Xatolar ustida ishlash (${Math.min(u.wrong.length, 10)})`, "mx").row();
        kb.text("📈 Statistika", "ms");
        await dm(p.uid, buildCard(s, p, rank, ranking.length, total, u, newBadges, wrongItems), { reply_markup: kb });

        // Past natija: ertasi kuni eslatma (xatolar ro'yxati bo'sh bo'lmasa)
        if (s.remind && s.kind !== "mistakes" && pct < LOW_SCORE_PCT && u.wrong.length) {
          const due = Date.parse(`${tashDay()}T05:00:00Z`) + 86400000; // ertaga 10:00 (Toshkent)
          await setJSON(`remind/${p.uid}`, { due, title: s.title });
        }
      } catch (e) {
        await reportError("card", e, `user ${p.uid}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // Guruh testi: o'qituvchiga hisobot
  if (isGroupType(s.chatType)) {
    const report = buildReport(s, ranking, perPoll, total, lowReport);
    await setJSON(`report/${chatId}`, { ts: Date.now(), text: report });
    if (s.startedBy) await dm(s.startedBy, report);
  }
}

// ---------- o'qituvchi hisoboti ----------

function buildReport(s, ranking, perPoll, total, lowNames) {
  const pcts = ranking.map((p) => Math.round((p.correct / total) * 100));
  const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  const hardest = [...perPoll.entries()]
    .map(([pid, v]) => ({ qi: s.pollQ?.[pid], wrong: v.wrong, n: v.right + v.wrong }))
    .filter((x) => x.qi !== undefined && x.wrong > 0)
    .sort((a, b) => b.wrong / b.n - a.wrong / a.n || b.n - a.n)
    .slice(0, 3);

  let t = `📑 <b>Test hisoboti</b> — ${esc(s.title)}\n`;
  t += `📅 ${tashDay()} · 👥 ${ranking.length} ishtirokchi · 📝 ${total} savol\n\n`;
  t += `📊 O'rtacha natija: <b>${avg}%</b>\n`;
  t += `🥇 Eng yaxshi: <b>${Math.max(...pcts)}%</b> · 🔻 Eng past: <b>${Math.min(...pcts)}%</b>\n`;
  if (hardest.length) {
    t += `\n⚠️ <b>Eng ko'p xato qilingan savollar:</b>\n`;
    t += hardest
      .map((h, i) => `${i + 1}. ${esc(trunc(s.questions[h.qi].question, 80))}\n   ${Math.round((h.wrong / h.n) * 100)}% xato (${h.wrong}/${h.n})`)
      .join("\n");
    t += "\n";
  }
  if (lowNames.length) {
    t += `\n👎 <b>Natijasi past (${LOW_SCORE_PCT}% dan kam):</b>\n${lowNames.slice(0, 20).map(esc).join(", ")}\n`;
  }
  return trunc(t, 4000);
}

export async function lastReport(chatId) {
  return (await getJSON(`report/${chatId}`))?.text ?? null;
}
