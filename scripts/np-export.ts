/**
 * Section 6 Markdown for New Postcode research from saved runs (links-only or full).
 *   npm run np-export -- runs/np/*.json --quote-start=51 [--out=research/x.md] [--paraphrase] [--replay]
 * Offline by default (--replay is the default and only reads files). --paraphrase writes missing quote paraphrases
 * for runs saved with post text (store full); that spends LLM money.
 */
import { readFile, writeFile } from "node:fs/promises";
import { exportMarkdown, fillMissingQuotes, loadRun } from "../src/np/export.ts";

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => { const [k, ...v] = a.slice(2).split("="); return [k, v.join("=")]; })) as Record<string, string>;
const files = argv.filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: np-export <run.json ...> --quote-start=N [--out=file.md] [--paraphrase]");
  process.exit(1);
}
const runs = await Promise.all(files.map(async (f) => loadRun(JSON.parse(await readFile(f, "utf8")))));
const filled = await fillMissingQuotes(runs, { paraphrase: "paraphrase" in args, perOption: Number(args.quotes ?? 5) });
if (filled.spentUsd) console.error(`paraphrases: $${filled.spentUsd.toFixed(4)}`);
if (filled.skippedNoText.length) console.error(`no post text to paraphrase (links-only): ${filled.skippedNoText.join("; ")}`);
const md = exportMarkdown(runs, { quoteStart: Number(args["quote-start"] ?? 1) });
if (args.out) await writeFile(args.out, md);
else process.stdout.write(md);
