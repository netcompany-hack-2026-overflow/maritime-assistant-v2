import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";

/** apps/api, from src/services (tsx) or dist/services (built). */
const API_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function runSeed(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["prisma", "db", "seed"], {
      cwd: API_ROOT,
      env: process.env,
      shell: process.platform === "win32",
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Το seed άργησε πάνω από 2 λεπτά."));
    }, 120_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Το seed απέτυχε (κωδικός ${code}). Δείτε τα logs του API.`));
    });
  });
}

/**
 * Put the demo back to its starting point for a presentation: every email,
 * port event, recommendation, reply, notice, charter party and voyage is
 * deleted, then the seed recreates the voyages (ships positioned "now") and
 * the queued inbox. Ports, vessels, suppliers and price settings are kept.
 */
export async function resetDemo(): Promise<{ voyages: number; queuedEmails: number }> {
  await prisma.$transaction([
    prisma.emailDraft.deleteMany({}),
    prisma.outboundEmail.deleteMany({}),
    prisma.recommendation.deleteMany({}),
    prisma.portEvent.deleteMany({}),
    prisma.email.deleteMany({}),
    prisma.charterParty.deleteMany({}),
    prisma.voyage.deleteMany({}),
    prisma.auditLog.deleteMany({}),
  ]);
  const output = await runSeed();
  console.log("Demo reset: seed finished.", output.split("\n").filter((l) => /seed|Seed/.test(l)).join(" | "));
  const [voyages, queuedEmails] = await Promise.all([
    prisma.voyage.count(),
    prisma.email.count({ where: { queued: true } }),
  ]);
  return { voyages, queuedEmails };
}
