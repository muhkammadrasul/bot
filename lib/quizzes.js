import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

// Telegram cheklovlari (savol oldiga "[12/20] " qo'shilgani uchun 290)
const MAX_QUESTION = 290;
const MAX_OPTION = 100;
const MAX_EXPLANATION = 200;

export const DEFAULT_TIME = 20;

/**
 * quizzes/ papkasidagi har bir .json fayl — bitta test.
 * Fayl nomi testning ID si bo'ladi (masalan to_be_1.json -> /quiz to_be_1).
 */
export function loadQuizzes(dir) {
  const quizzes = new Map();
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

  for (const file of files) {
    const id = basename(file, ".json");
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(id)) {
      throw new Error(`${file}: fayl nomida faqat lotin harflari, raqamlar, _ va - bo'lishi mumkin`);
    }

    let data;
    try {
      data = JSON.parse(readFileSync(join(dir, file), "utf8").replace(/^﻿/, ""));
    } catch (e) {
      throw new Error(`${file}: JSON yozilishida xato — ${e.message}`);
    }

    const fail = (msg) => {
      throw new Error(`${file}: ${msg}`);
    };

    if (typeof data.title !== "string" || !data.title.trim()) fail(`"title" (test nomi) yozilmagan`);
    const time = data.time ?? DEFAULT_TIME;
    if (!Number.isInteger(time) || time < 5 || time > 600) fail(`"time" 5 dan 600 gacha butun son bo'lishi kerak`);
    if (!Array.isArray(data.questions) || data.questions.length === 0) fail(`"questions" ro'yxati bo'sh`);

    data.questions.forEach((q, i) => {
      const n = `${i + 1}-savol`;
      if (typeof q.question !== "string" || !q.question.trim()) fail(`${n}: "question" yozilmagan`);
      if (q.question.length > MAX_QUESTION) fail(`${n}: savol ${MAX_QUESTION} belgidan uzun`);
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) {
        fail(`${n}: "options" da 2 tadan 10 tagacha variant bo'lishi kerak`);
      }
      for (const o of q.options) {
        if (typeof o !== "string" || !o.trim()) fail(`${n}: bo'sh variant bor`);
        if (o.length > MAX_OPTION) fail(`${n}: "${o.slice(0, 20)}..." varianti ${MAX_OPTION} belgidan uzun`);
      }
      if (new Set(q.options).size !== q.options.length) fail(`${n}: bir xil variantlar takrorlangan`);
      if (!q.options.includes(q.answer)) fail(`${n}: "answer" variantlardan biri bilan aynan bir xil bo'lishi kerak`);
      if (q.explanation != null) {
        if (typeof q.explanation !== "string") fail(`${n}: "explanation" matn bo'lishi kerak`);
        if (q.explanation.length > MAX_EXPLANATION) fail(`${n}: izoh ${MAX_EXPLANATION} belgidan uzun`);
      }
    });

    quizzes.set(id, {
      id,
      title: data.title.trim(),
      description: typeof data.description === "string" ? data.description.trim() : "",
      time,
      questions: data.questions,
    });
  }

  if (quizzes.size === 0) throw new Error(`quizzes papkasida birorta ham test (.json fayl) yo'q`);
  return quizzes;
}
