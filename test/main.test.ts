import { describe, test } from "vitest";
import { Diarization } from "../src/index.js";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as process from "process";
import logger from "../src/logger.js";
import { opts } from "../src/opts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Diarizes audio", async () => {
  test(`it throws when file doesn't exist`, async ({ expect }) => {
    const diarizer = new Diarization({
      ...opts,
      input: resolve(join(__dirname, "audio/nonexistant.aac")),
      apiKey: "test",
      client: "assemblyai",
    });
    await expect(() => diarizer.diarizeAudio()).rejects.toThrow();
  });

  test(`it diarizes audio`, async ({ expect }) => {
    const apiKey = String(process.env.DEEPGRAM_API_KEY || "");
    if (!apiKey) {
      logger.warn("Deepgram API key not found");
      return;
    }
    const diarizer = new Diarization({
      ...opts,
      input: resolve(join(__dirname, "audio/audio.aac")),
      apiKey,
      client: "deepgram",
    });
    await diarizer.diarizeAudio();
    expect(true).toBe(true);
  });

  test(`it extracts audio from video and diarizes it`, async ({ expect }) => {
    const apiKey = String(process.env.DEEPGRAM_API_KEY || "");
    if (!apiKey) {
      logger.warn("Deepgram API key not found");
      return;
    }
    const diarizer = new Diarization({
      ...opts,
      language: "en-US",
      input: resolve(join(__dirname, "video")),
      apiKey,
      client: "deepgram",
      verbose: true,
    });
    await diarizer.diarizeAudio();
    expect(true).toBe(true);
  });

  test(`it extracts audio from video and diarizes it - assemblyai`, async ({ expect }) => {
    const apiKey = String(process.env.ASSEMBLYAI_API_KEY || "");
    if (!apiKey) {
      logger.warn("Deepgram API key not found");
      return;
    }
    const diarizer = new Diarization({
      ...opts,
      language: "en-US",
      input: resolve(join(__dirname, "video")),
      apiKey,
      client: "assemblyai",
      verbose: true,
    });
    await diarizer.diarizeAudio();
    expect(true).toBe(true);
  });
});
