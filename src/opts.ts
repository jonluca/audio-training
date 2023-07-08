import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const instance = yargs(hideBin(process.argv));
export const opts = instance
  .options({
    input: { type: "string", alias: "f", demandOption: true, default: "", description: "Input file or directory" },
    verbose: { type: "string", alias: "v", default: false, description: "Verbose logging" },
    mergeAudio: {
      type: "boolean",
      alias: "m",
      default: true,
      description: "Merge all audio files in each speaker directory after processing",
    },
    apiKey: {
      type: "string",
      alias: "a",
      default: process.env.DEEPGRAM_API_KEY || process.env.ASSEMBLYAI_API_KEY || "",
    },
  })
  .alias("language", "l")
  .default("language", "en-US")
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
  .wrap(120)
  .parseSync();
export type AudioCliOpts = typeof opts;

export type AudioOpts = AudioCliOpts & { input: NonNullable<AudioCliOpts["input"]> };
