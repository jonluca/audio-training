import { describe, test } from "vitest";
import { Diarization } from "../src/index.js";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as process from "process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Diarizes audio", async () => {
  test(`it throws when file doesn't exist`, async ({ expect }) => {
    const diarizer = new Diarization({
      language: "en-US",
      input: resolve(join(__dirname, "audio/nonexistant.aac")),
      apiKey: "test",
      _: [],
      $0: "",
    });
    await expect(() => diarizer.diarizeAudio()).rejects.toThrow();
  });

  test(`it diarizes audio`, async ({ expect }) => {
    const diarizer = new Diarization({
      language: "en-US",
      input: resolve(join(__dirname, "audio/audio.aac")),
      apiKey: String(process.env.DEEPGRAM_API_KEY || ""),
      _: [],
      $0: "",
    });
    await diarizer.diarizeAudio();
    expect(true).toBe(true);
  });
});
