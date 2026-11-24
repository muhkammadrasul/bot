# Linguify Quiz — Netlify versiyasi

Telegram quiz bot, Netlify'da ishlaydi (kompyuter yoqiq turishi shart emas).

## Qanday ishlaydi

| Qism | Fayl | Vazifasi |
|---|---|---|
| Webhook | `netlify/functions/telegram.mjs` | Telegram har bir xabar/tugmani shu yerga yuboradi |
| Test o'tkazuvchi | `netlify/functions/quiz-runner-background.mjs` | Fon funksiyasi (15 daqiqagacha): kutish xonasi → savollar → reyting. Uzun testda o'zini davom ettiradi |
| Sozlash | `netlify/functions/setup.mjs` | Bir marta ochiladi: Telegram'ni saytga ulaydi |
| Xotira | Netlify Blobs | Sozlamalar, guruhlar, javoblar |
| Testlar | `quizzes/*.json` | Deploy paytida tekshirilib, kodga yig'iladi |

## Joylash (bir marta)

### 1. Netlify CLI va kirish
```powershell
npm install -g netlify-cli
```
```powershell
netlify login
```
Brauzer ochiladi — Netlify akkauntingizga kiring.

### 2. Sayt yaratish
Shu papkada:
```powershell
netlify sites:create
```
Nom bering, masalan `linguify-quiz` → sayt manzili `https://linguify-quiz.netlify.app` bo'ladi.

```powershell
netlify link
```

### 3. Maxfiy o'zgaruvchilar (Netlify saytida)
**app.netlify.com → saytingiz → Site configuration → Environment variables → Add a variable**:

| Nomi | Qiymati |
|---|---|
| `BOT_TOKEN` | @BotFather bergan token |
| `WEBHOOK_SECRET` | shu papkadagi `.env` faylidagi qiymat |

### 4. Deploy
```powershell
netlify deploy --build --prod
```

### 5. Telegram'ni saytga ulash
Brauzerda oching (o'z sayt nomingiz va `WEBHOOK_SECRET` bilan):
```
https://linguify-quiz.netlify.app/.netlify/functions/setup?key=WEBHOOK_SECRET
```
`✅ Tayyor!` chiqsa — bot Netlify'da ishlayapti.

> ⚠️ Kompyuterdagi eski botni (`npm start`) o'chiring — webhook ulangach u baribir ishlamaydi.

## Yangi test qo'shish
`quizzes/` ga `.json` fayl qo'shing (namuna: `to_be_1.json`) va qayta deploy qiling:
```powershell
netlify deploy --build --prod
```
Xato bo'lsa, deploy to'xtaydi va qaysi fayl/savolda ekanini aytadi.

## Cheklovlar
- Test boshlanishi va savollar orasida 1–2 soniya kechikish bo'lishi mumkin (fon funksiyasi xotirani har 2 soniyada tekshiradi).
- Netlify bepul tarifida oylik limitlar bor (funksiya chaqiruvlari, Blobs). Kichik va o'rta guruhlar uchun yetarli; juda faol bo'lsa — app.netlify.com da "Usage" bo'limini kuzating.
