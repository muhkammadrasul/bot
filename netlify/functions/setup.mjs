// Bir marta ochiladi: https://SAYTINGIZ.netlify.app/.netlify/functions/setup?key=WEBHOOK_SECRET
// Telegram'ga "xabarlarni shu saytga yubor" deb aytadi va buyruqlar menyusini o'rnatadi.
import { bot, TOKEN, SECRET } from "../../lib/core.js";

export default async (req, context) => {
  if (!TOKEN || !SECRET) {
    return new Response("❌ Netlify'da BOT_TOKEN va WEBHOOK_SECRET o'zgaruvchilari sozlanmagan.", { status: 500 });
  }
  if (new URL(req.url).searchParams.get("key") !== SECRET) {
    return new Response("❌ Kalit noto'g'ri. Manzil oxiriga ?key=WEBHOOK_SECRET qo'shing.", { status: 403 });
  }

  const site = context?.site?.url || process.env.URL;
  const webhook = `${site}/.netlify/functions/telegram`;

  await bot.api.setWebhook(webhook, {
    secret_token: SECRET,
    drop_pending_updates: true,
    allowed_updates: ["message", "channel_post", "callback_query", "poll_answer", "my_chat_member"],
  });
  await bot.api.setMyCommands([
    { command: "quiz", description: "Testlar ro'yxati / testni boshlash" },
    { command: "stop", description: "Testni to'xtatish" },
    { command: "settings", description: "Sozlamalar" },
    { command: "groups", description: "Mening guruhlarim (boshqarish)" },
    { command: "time", description: "Savol vaqtini yozish, masalan /time 25" },
    { command: "manager", description: "Guruhda: reply qilib boshqarish huquqini berish/olish" },
    { command: "help", description: "Yordam" },
  ]);
  const me = await bot.api.getMe();
  const info = await bot.api.getWebhookInfo();

  return new Response(
    `✅ Tayyor! @${me.username} endi Netlify'da ishlaydi.\n\nWebhook: ${info.url}\nKutilayotgan xabarlar: ${info.pending_update_count}` +
      (info.last_error_message ? `\nOxirgi xato: ${info.last_error_message}` : ""),
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
};
