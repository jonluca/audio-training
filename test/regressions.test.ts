import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";
import { execa } from "execa";
import { Diarization } from "../src/index.js";
import { toAssemblyAiLanguageCode } from "../src/clients/assemblyai.js";
import { opts } from "../src/opts.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "audio-training-"));
  temporaryDirectories.push(directory);
  return directory;
};

const makeDiarizer = (input: string, language = "en-US") => {
  const diarizer = new Diarization({
    ...opts,
    input,
    apiKey: "test",
    client: "assemblyai",
    language: language as typeof opts.language,
    mergeAudio: false,
  });
  const processAudio = vi.fn(async () => ({ utterances: [] }));
  diarizer.transcriber = { processAudio };
  vi.spyOn(diarizer, "splitAudioBySpeakers").mockResolvedValue();
  return { diarizer, processAudio };
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("cache and input selection", () => {
  test("keys cached transcripts by source content and language and returns cached outputs", async () => {
    const directory = await makeTemporaryDirectory();
    const file = join(directory, "recording.aac");
    await writeFile(file, "first source");
    const { diarizer, processAudio } = makeDiarizer(file);

    const firstOutput = await diarizer.diarizeFile(file);
    processAudio.mockClear();
    const cachedOutput = await diarizer.diarizeFile(file);

    expect(cachedOutput).toBe(firstOutput);
    expect(processAudio).not.toHaveBeenCalled();

    await writeFile(file, "changed source");
    await diarizer.diarizeFile(file);
    expect(processAudio).toHaveBeenCalledOnce();

    const french = makeDiarizer(file, "fr");
    await french.diarizer.diarizeFile(file);
    expect(french.processAudio).toHaveBeenCalledOnce();
  });

  test("uses distinct workspaces for files sharing a basename", async () => {
    const directory = await makeTemporaryDirectory();
    const aac = join(directory, "recording.aac");
    const wav = join(directory, "recording.wav");
    await writeFile(aac, "aac");
    await writeFile(wav, "wav");
    const { diarizer } = makeDiarizer(aac);

    const outputs = await Promise.all([diarizer.diarizeFile(aac), diarizer.diarizeFile(wav)]);

    expect(outputs[0]).not.toBe(outputs[1]);
    expect(outputs[0]).toContain("recording.aac-diarization");
    expect(outputs[1]).toContain("recording.wav-diarization");
  });

  test("does not exclude legitimate directories named speakers", async () => {
    const directory = join(await makeTemporaryDirectory(), "speakers");
    const file = join(directory, "recording.aac");
    await mkdir(directory, { recursive: true });
    await writeFile(file, "audio");
    const { diarizer } = makeDiarizer(directory);
    const diarizeFile = vi.spyOn(diarizer, "diarizeFile").mockResolvedValue("output");

    expect(await diarizer.diarizeAudio()).toEqual(["output"]);
    expect(diarizeFile).toHaveBeenCalledWith(file);
  });
});

test("maps CLI language choices to AssemblyAI language codes", () => {
  expect(toAssemblyAiLanguageCode("en-US")).toBe("en_us");
  expect(toAssemblyAiLanguageCode("en-GB")).toBe("en_uk");
  expect(toAssemblyAiLanguageCode("pt-BR")).toBe("pt_br");
});

test("mixes every movie audio stream into a supported mono WAV", async () => {
  const directory = await makeTemporaryDirectory();
  const movie = join(directory, "multi-track.mkv");
  await execa(ffmpegPath, [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=0.1",
    "-map",
    "0:a",
    "-map",
    "1:a",
    "-c:a",
    "pcm_s16le",
    movie,
  ]);
  const { diarizer, processAudio } = makeDiarizer(movie);
  processAudio.mockImplementation(async (convertedFile) => {
    expect(convertedFile).toMatch(/\.wav$/);
    const probe = await execa(ffprobePath, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,channels",
      "-of",
      "json",
      convertedFile,
    ]);
    const streams = JSON.parse(probe.stdout).streams;
    expect(streams).toEqual([{ codec_name: "pcm_s16le", channels: 1 }]);
    return { utterances: [] };
  });

  await diarizer.diarizeFile(movie);

  expect(processAudio).toHaveBeenCalledOnce();
});
