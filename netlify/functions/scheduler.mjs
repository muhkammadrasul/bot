// Har 5 daqiqada ishlaydi: rejalashtirilgan testlar, eslatmalar, kunlik zaxira
import { runScheduled, runReminders } from "../../lib/sched.js";
import { backupIfDue, reportError } from "../../lib/admin.js";

export default async () => {
  const out = {};
  for (const [name, fn] of [["tests", runScheduled], ["reminders", runReminders], ["backup", backupIfDue]]) {
    try {
      out[name] = await fn();
    } catch (e) {
      await reportError(`scheduler:${name}`, e);
    }
  }
  console.log("scheduler", JSON.stringify(out));
  return new Response(JSON.stringify(out));
};

export const config = { schedule: "*/5 * * * *" };
