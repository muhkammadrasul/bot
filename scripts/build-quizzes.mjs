// quizzes/*.json -> lib/quizzes.generated.js
// Xato bo'lsa (masalan javob variantlarda yo'q), build to'xtaydi va qaysi fayl/savol ekanini aytadi.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadQuizzes } from "../lib/quizzes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const quizzes = [...loadQuizzes(join(ROOT, "quizzes")).values()];

writeFileSync(
  join(ROOT, "lib", "quizzes.generated.js"),
  "// Avtomatik yaratilgan — tahrirlamang. Testlarni quizzes/*.json da o'zgartiring.\n" +
    `export default ${JSON.stringify(quizzes, null, 2)};\n`,
);
console.log(`✅ ${quizzes.length} ta test yig'ildi: ${quizzes.map((q) => q.id).join(", ")}`);
