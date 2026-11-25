// Sof (toza) matn tahlil funksiyalari: ko'p savol va lug'at formatlari

export const MAX_Q = 290; // "[12/20] " prefiksi uchun joy qoldiriladi (Telegram chegarasi 300)
export const MAX_OPT = 100;
export const MAX_EXP = 200;
export const MAX_QUESTIONS = 200;
const LETTERS = "ABCDEFGHIJ";

export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
export const cleanText = (s) => String(s).replace(/\s+/g, " ").trim();

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** "B", "B)", "2", yoki variant matni -> indeks (topilmasa -1) */
function resolveAnswer(raw, options) {
  const a = raw.trim();
  const letter = a.match(/^([A-Ja-j])(?:[\)\.\s:]|$)/);
  if (letter) {
    const i = LETTERS.indexOf(letter[1].toUpperCase());
    if (i < options.length) return i;
  }
  const num = a.match(/^(\d{1,2})(?:[\)\.\s]|$)/);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= options.length) return Number(num[1]) - 1;
  return options.findIndex((o) => o.toLowerCase() === a.toLowerCase());
}

/**
 * Bitta xabardagi ko'p savolni o'qiydi. Qo'llab-quvvatlanadigan format:
 *   1. Savol matni?
 *   A) variant
 *   B) variant
 *   Javob: B          (yoki to'g'ri variant oxiriga ✅ yoki boshiga * qo'ying)
 *   Izoh: ixtiyoriy
 * Qaytaradi: { questions: [{question, options, answer, explanation}], errors: [matn] }
 */
export function parseBulk(text) {
  const lines = String(text).replace(/\r/g, "").split("\n").map((l) => l.trim());
  const questions = [];
  const errors = [];
  let cur = null;
  let seq = 0;

  const optRe = /^([A-Ja-j])\s*[\)\.\:]\s*(.+)$/;
  const ansRe = /^(?:javob|to['’`]?g['’`]?ri\s*javob|answer|ans|jav)\s*[:\-=]\s*(.+)$/i;
  const expRe = /^(?:izoh|tushuntirish|explanation|exp)\s*[:\-=]\s*(.+)$/i;
  const numRe = /^(\d{1,3})\s*[\.\)\-:]\s*(.+)$/;

  const flush = () => {
    if (!cur) return;
    const label = `${cur.n}-savol`;
    const q = cleanText(cur.q);
    const opts = cur.options;
    cur = null;
    if (!q) return void errors.push(`${label}: savol matni yo'q`);
    if (opts.length < 2) return void errors.push(`${label}: kamida 2 ta variant kerak`);
    if (opts.length > 10) return void errors.push(`${label}: 10 tadan ortiq variant bo'lmaydi`);
    const texts = opts.map((o) => o.text);
    if (texts.some((t) => t.length > MAX_OPT)) return void errors.push(`${label}: variant ${MAX_OPT} belgidan uzun`);
    if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) return void errors.push(`${label}: bir xil variantlar bor`);

    let idx = -1;
    if (cur_ans !== null) idx = resolveAnswer(cur_ans, texts);
    else {
      const marked = opts.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
      if (marked.length === 1) idx = marked[0];
    }
    if (idx < 0) return void errors.push(`${label}: to'g'ri javob topilmadi ("Javob: B" deb yozing)`);
    questions.push({
      question: clip(q, MAX_Q),
      options: texts,
      answer: texts[idx],
      explanation: cur_exp ? clip(cleanText(cur_exp), MAX_EXP) : null,
    });
  };

  // flush() ichida kerak bo'ladigan joriy javob/izoh (cur null qilinishidan oldin saqlanadi)
  let cur_ans = null;
  let cur_exp = null;
  const begin = (qtext) => {
    seq++;
    cur = { n: seq, q: qtext, options: [] };
    cur_ans = null;
    cur_exp = null;
  };
  const flushNow = () => {
    // flush cur_ans/cur_exp ni cur bilan birga ishlatadi
    flush();
  };

  for (const line of lines) {
    if (!line) continue;
    let m;
    if (cur && (m = line.match(ansRe))) {
      cur_ans = m[1];
      continue;
    }
    if (cur && (m = line.match(expRe))) {
      cur_exp = m[1];
      continue;
    }
    if (cur && cur.q && (m = line.match(optRe))) {
      let t = m[2].trim();
      let ok = false;
      if (/^\*\s*/.test(t)) {
        ok = true;
        t = t.replace(/^\*\s*/, "");
      }
      if (/(✅|✔️|✓)\s*$/.test(t)) {
        ok = true;
        t = t.replace(/\s*(✅|✔️|✓)\s*$/, "");
      }
      cur.options.push({ text: cleanText(t), ok });
      continue;
    }
    const num = line.match(numRe);
    const qtext = num ? num[2] : line;
    if (cur && cur.options.length === 0 && cur_ans === null) {
      cur.q += " " + line; // ko'p qatorli savol
      continue;
    }
    flushNow();
    begin(qtext);
  }
  flushNow();
  return { questions, errors };
}

/** "so'z - tarjima" qatorlarini o'qiydi. */
export function parseVocab(text) {
  const pairs = [];
  const seen = new Set();
  let bad = 0;
  for (let line of String(text).replace(/\r/g, "").split("\n")) {
    line = line.trim().replace(/^\d{1,3}\s*[\.\)]\s+/, "");
    if (!line) continue;
    const m = line.match(/^(.+?)(?:\t+|\s+[-–—]\s+|\s*=\s*|\s*:\s*)(.+)$/);
    if (!m) {
      bad++;
      continue;
    }
    const w = cleanText(m[1]);
    const t = cleanText(m[2]);
    if (!w || !t || w.length > MAX_OPT - 2 || t.length > MAX_OPT || seen.has(w.toLowerCase())) {
      bad++;
      continue;
    }
    seen.add(w.toLowerCase());
    pairs.push({ w, t });
  }
  return { pairs, bad };
}

function vocabBuild(items, qText) {
  return items
    .map((it, i) => {
      const others = shuffled(items.filter((_, j) => j !== i).map((x) => x.b).filter((b) => b.toLowerCase() !== it.b.toLowerCase()));
      const uniq = [];
      for (const o of others) {
        if (!uniq.some((u) => u.toLowerCase() === o.toLowerCase())) uniq.push(o);
        if (uniq.length === 3) break;
      }
      return {
        question: qText(it.a),
        options: shuffled([it.b, ...uniq]),
        answer: it.b,
        explanation: clip(`${it.a} — ${it.b}`, MAX_EXP),
      };
    })
    .filter((q) => q.options.length >= 2);
}

/** dir: "w" (so'z -> tarjima), "t" (tarjima -> so'z), "b" (ikkalasi) */
export function makeVocabQuestions(pairs, dir) {
  let out = [];
  if (dir === "w" || dir === "b") out = out.concat(vocabBuild(pairs.map((p) => ({ a: p.w, b: p.t })), (a) => `«${a}» — tarjimasi qaysi?`));
  if (dir === "t" || dir === "b") out = out.concat(vocabBuild(pairs.map((p) => ({ a: p.t, b: p.w })), (a) => `«${a}» — qaysi so'z?`));
  return out.slice(0, MAX_QUESTIONS);
}
