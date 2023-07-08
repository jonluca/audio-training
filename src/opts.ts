import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export const opts = yargs(hideBin(process.argv))
  .options({
    input: { type: "string", alias: "f", demandOption: true, description: "Input file or directory" },

    apiKey: { type: "string", alias: "a", default: process.env.DEEPGRAM_API_KEY || "" },
  })
  .choices("language", [
    "zh",
    "zh-CN",
    "zh-TW",
    "da",
    "nl",
    "en",
    "en-AU",
    "en-GB",
    "en-IN",
    "en-NZ",
    "en-US",
    "nl",
    "fr",
    "fr-CA",
    "de",
    "hi",
    "hi-Latn",
    "id",
    "it",
    "ja",
    "ko",
    "no",
    "pl",
    "pt",
    "pt-BR",
    "pt-PT",
    "ru",
    "es",
    "es-419",
    "sv",
    "ta",
    "tr",
    "uk",
  ] as const)
  .default("client", "assemblyai")
  .choices("client", ["deepgram", "assemblyai"] as const)
  .parseSync();
export type AudioCliOpts = typeof opts;
export type AudioOpts = Exclude<AudioCliOpts, "$0">;