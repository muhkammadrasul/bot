// Bot egasi uchun: xatolik xabarlari, admin panel, zaxira (backup) va tiklash
import { InlineKeyboard, InputFile } from "grammy";
import {
  bot, TOKEN, OWNER_ID, getJSON, setJSON, getText, setText, listKeys, tashDay, esc, trunc, isGroupType, enabledOf,
} from "./core.js";

export const isOwner = (id) => Boolean(OWNER_ID) && Number(id) === OWNER_ID;

// ---------- xatoliklar ----------

/** Xatoni jurnalga yozadi va bot egasiga (10 daqiqada bir xil xatoni bir marta) xabar yuboradi. Hech qachon xato tashlamaydi. */
export async function reportError(source, err, extra = "") {
  const msg = String(err?.message ?? err).slice(0, 300);
  console.error(`[${source}]`, err);
  try {
    const log = (await getJSON("meta/errors")) ?? [];
    log.push({ ts: Date.now(), source, msg, extra: String(extra).slice(0, 100) });
    await setJSON("meta/errors", log.slice(-20));

    if (!OWNER_ID) return;
    const k = `meta/errnotify/${source}`;
    const last = Number((await getText(k)) ?? 0);
    if (Date.now() - last < 10 * 60 * 1000) return;
    await setText(k, String(Date.now()));
    await bot.api.sendMessage(OWNER_ID, `⚠️ <b>Xatolik</b> (${esc(source)})\n<code>${esc(msg)}</code>${extra ? `\n${esc(extra)}` : ""}`, { parse_mode: "HTML" });
  } catch {
    /* jurnal yozilmasa ham asosiy ish to'xtamasin */
  }
}

// ---------- zaxira ----------

const BACKUP_PREFIXES = ["chat/", "quiz/", "uq/", "user/", "sched/", "remind/", "meta/stats", "report/"];

export async function buildBackup() {
  const items = {};
  for (const prefix of BACKUP_PREFIXES) {
    for (const key of await listKeys(prefix)) items[key] = await getText(key);
  }
  return { version: 1, ts: Date.now(), items };
}

export async function sendBackup(toId = OWNER_ID, note = "Avtomatik zaxira") {
  if (!toId) return false;
  const data = await buildBackup();
  const name = `linguify-backup-${tashDay()}.json`;
  await bot.api.sendDocument(toId, new InputFile(Buffer.from(JSON.stringify(data)), name), {
    caption: `💾 ${note}\n📦 ${Object.keys(data.items).length} ta yozuv.\nTiklash: shu faylga javob (reply) qilib /restore yozing.`,
  });
  await setText("meta/lastBackup", tashDay());
  return true;
}

export async function restoreBackup(data) {
  if (!data || data.version !== 1 || typeof data.items !== "object") throw new Error("Zaxira fayli noto'g'ri");
  let n = 0;
  for (const [key, val] of Object.entries(data.items)) {
    if (!BACKUP_PREFIXES.some((p) => key.startsWith(p)) || val == null) continue;
    await setText(key, String(val));
    n++;
  }
  return n;
}

/** Bot egasi uchun avtomatik zaxira: Toshkent vaqti bilan 03:00–03:10 oralig'ida, kuniga bir marta */
export async function backupIfDue(now = Date.now()) {
  if (!OWNER_ID) return false;
  const t = new Date(now + 5 * 3600e3);
  if (t.getUTCHours() !== 3 || t.getUTCMinutes() >= 15) return false;
  if ((await getText("meta/lastBackup")) === tashDay(now)) return false;
  return sendBackup(OWNER_ID, "Kunlik avtomatik zaxira");
}

// ---------- admin panel ----------

export async function adminText() {
  const [users, chats, quizzes, scheds, stats] = await Promise.all([
    listKeys("user/"),
    listKeys("chat/"),
    listKeys("quiz/"),
    listKeys("sched/"),
    getJSON("meta/stats"),
  ]);
  const chatData = await Promise.all(chats.slice(0, 300).map((k) => getJSON(k)));
  const groups = chatData.filter((c) => c && isGroupType(c.type) && !c.left);
  const channels = chatData.filter((c) => c && c.type === "channel" && !c.left);
  const week = tashDay(Date.now() - 6 * 86400000);
  const userData = await Promise.all(users.slice(0, 500).map((k) => getJSON(k)));
  const active7 = userData.filter((u) => u?.lastDay && u.lastDay >= week).length;
  return (
    "🛠 <b>Admin panel</b>\n\n" +
    `🧪 O'tkazilgan testlar: <b>${stats?.tests ?? 0}</b>\n` +
    `👥 Guruhlar: <b>${groups.length}</b> · 📢 Kanallar: <b>${channels.length}</b>\n` +
    `🙋 Test yechgan foydalanuvchilar: <b>${users.length}</b> (so'nggi 7 kunda faol: ${active7})\n` +
    `📚 Foydalanuvchi testlari: <b>${quizzes.length}</b>\n` +
    `⏰ Rejalashtirilgan testlar: <b>${scheds.length}</b>\n` +
    `💾 Oxirgi zaxira: <b>${(await getText("meta/lastBackup")) ?? "hali yo'q"}</b>`
  );
}

export const adminKeyboard = () =>
  new InlineKeyboard().text("💾 Zaxira olish", "ad:bk").text("👥 Guruhlar", "ad:gr").row().text("⚠️ So'nggi xatolar", "ad:er").text("🔄 Yangilash", "ad:rf");

export async function groupsText() {
  const keys = await listKeys("chat/");
  const data = await Promise.all(keys.slice(0, 300).map(async (k) => ({ id: k.slice(5), ...(await getJSON(k)) })));
  const rows = data.filter((c) => (isGroupType(c.type) || c.type === "channel") && !c.left);
  if (!rows.length) return "Hozircha guruh yo'q.";
  return (
    "👥 <b>Guruh va kanallar</b>\n\n" +
    rows.map((c) => `${enabledOf(c) ? "🟢" : "🔴"} ${c.type === "channel" ? "📢" : "👥"} ${esc(trunc(c.title ?? c.id, 40))}`).join("\n")
  );
}

export async function errorsText() {
  const log = (await getJSON("meta/errors")) ?? [];
  if (!log.length) return "✅ Xatoliklar yo'q.";
  return (
    "⚠️ <b>So'nggi xatolar</b>\n\n" +
    [...log]
      .reverse()
      .slice(0, 10)
      .map((e) => `• ${new Date(e.ts + 5 * 3600e3).toISOString().slice(5, 16).replace("T", " ")} [${esc(e.source)}] ${esc(trunc(e.msg, 120))}`)
      .join("\n")
  );
}

export async function downloadTelegramFile(fileId) {
  const f = await bot.api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error("Faylni yuklab bo'lmadi");
  return await res.text();
}
