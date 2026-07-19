import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as fsp from "fs/promises";
import mime from "mime-types";
import { glob } from "glob";
import type { AudioOpts } from "./opts.js";
import * as path from "path";
import pMap from "p-map";
import type { AudioProcessor, DiarizedAudio } from "./clients/base.js";
import DeepgramTranscriber from "./clients/deepgram.js";
import AssemblyAITranscriber from "./clients/assemblyai.js";
import logger from "./logger.js";
import fsJetpack from "fs-jetpack";
import { createHash } from "crypto";
export class Diarization {
  opts: AudioOpts;
  EXTRACTED_AUDIO_SUFFIX = "-diarization";
  transcriber: AudioProcessor;
  constructor(opts: AudioOpts) {
    this.opts = opts;
    switch (opts.client) {
      case "assemblyai":
        this.transcriber = new AssemblyAITranscriber(opts);
        break;
      case "deepgram":
        this.transcriber = new DeepgramTranscriber(opts);
        break;
      default:
        throw new Error(`Client ${opts.client} not found`);
    }

    try {
      ffmpeg.setFfmpegPath(ffmpegPath);
      ffmpeg.setFfprobePath(ffprobePath);
    } catch (err) {
      throw new Error("ffmpeg not found");
    }
  }
  diarizeAudio = async () => {
    logger.info(`Beginning audio diariazation`);
    const inputDirectoryOrFile = this.opts.input;
    const isDirectory = fs.lstatSync(inputDirectoryOrFile).isDirectory();
    const files = isDirectory ? await glob(`${inputDirectoryOrFile}/**`, { nodir: true }) : [inputDirectoryOrFile];
    const generatedSpeakerDirectories = new Set(["assemblyai-speakers", "deepgram-speakers"]);
    const filteredFiles = files.filter((file) => {
      const isExtractedAudio = path.parse(file).name.endsWith(this.EXTRACTED_AUDIO_SUFFIX);
      const isGeneratedSpeakerAudio = path
        .normalize(file)
        .split(path.sep)
        .some((segment) => generatedSpeakerDirectories.has(segment));
      return !isExtractedAudio && !isGeneratedSpeakerAudio;
    });
    const results = await pMap(
      filteredFiles,
      async (file) => {
        try {
          return await this.diarizeFile(file);
        } catch (e) {
          logger.error(`Error processing file ${file}: ${e}`);
        }
      },
      {
        concurrency: 8,
      },
    );

    return results.filter(Boolean) as string[];
  };

  private convertVideoFileToAudio = async (file: string, workingDirectory: string) => {
    if (this.opts.verbose) {
      logger.info(`Converting video file to audio: ${file}`);
    }
    // extract audio from video
    const audioInfo = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(file, (err, info) => {
        if (err) {
          reject(err);
        }
        resolve(info);
      });
    });
    const audioStream = audioInfo.streams.filter((stream) => stream.codec_type === "audio");
    if (!audioStream.length) {
      throw new Error("No audio stream found");
    }
    const isMultiStream = audioStream.length > 1;
    if (isMultiStream) {
      logger.warn("Multiple audio streams found, reencoding all into single stream");
    }
    const parsedFile = path.parse(file);
    const outputFileName = path.join(workingDirectory, `${parsedFile.name}${this.EXTRACTED_AUDIO_SUFFIX}.wav`);
    await new Promise<void>((resolve, reject) => {
      const command = ffmpeg();
      command.input(file);
      if (isMultiStream) {
        command.complexFilter(
          [
            {
              filter: "amix",
              options: { inputs: audioStream.length, duration: "longest" },
              inputs: audioStream.map((_, index) => `0:a:${index}`),
              outputs: "mixedAudio",
            },
          ],
          "mixedAudio",
        );
      }
      command
        .output(outputFileName)
        .noVideo()
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16_000)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
    if (this.opts.verbose) {
      logger.info(`Extracted audio file: ${outputFileName}`);
    }
    return outputFileName;
  };

  diarizeFile = async (file: string) => {
    // check if file exists
    if (!fs.existsSync(file)) {
      logger.error("File does not exist, did you pass --input correctly?", file);
      return;
    }
    let mimeType = mime.lookup(file);
    if (!mimeType) {
      logger.error("Mime type not found for file: ", file);
      return;
    }

    let inputFile = file;
    const parsedFile = path.parse(inputFile);
    const workingDirectory = path.join(parsedFile.dir, `${parsedFile.base}-diarization`);
    await fsp.mkdir(workingDirectory, { recursive: true });

    if (mimeType.startsWith("video")) {
      inputFile = await this.convertVideoFileToAudio(file, workingDirectory);
      mimeType = mime.lookup(inputFile);
      if (!mimeType) {
        logger.error("Mime type not found for file: ", file);
        return;
      }
    }

    if (!mimeType.startsWith("audio")) {
      logger.warn("Mime type not audio for file: ", inputFile);
      return;
    }

    const sourceHash = await new Promise<string>((resolve, reject) => {
      const hash = createHash("sha256");
      fs.createReadStream(file)
        .on("data", (chunk) => hash.update(chunk))
        .on("error", reject)
        .on("end", () => resolve(hash.digest("hex")));
    });
    const destinationFilename = `${parsedFile.name}-${this.opts.client}-${
      this.opts.language || "en-US"
    }-${sourceHash}.json`;
    const outputFile = path.join(workingDirectory, destinationFilename);
    // dont reprocess if file exists
    const verbose = this.opts.verbose;
    if (fs.existsSync(outputFile)) {
      if (verbose) {
        logger.info(`File already processed, skipping API re-diarization: ${file}`);
      }
      const contents = await fsp.readFile(outputFile, { encoding: "utf-8" });
      const output = JSON.parse(contents);
      await this.splitAudioBySpeakers(inputFile, workingDirectory, output);
      return workingDirectory;
    }

    try {
      if (verbose) {
        logger.info(`Diarizing file: ${file}`);
      }
      const output = await this.transcriber.processAudio(inputFile);
      if (verbose) {
        logger.info(`Diarization complete: ${file}`);
      }
      await fsp.writeFile(outputFile, JSON.stringify(output, null, 2));
      await this.splitAudioBySpeakers(inputFile, workingDirectory, output);
    } catch (e) {
      logger.error(`Error processing file ${file}: ${e}`);
    }
    return workingDirectory;
  };

  mergeAudioFiles = async (speakersDir: string) => {
    if (this.opts.verbose) {
      logger.info(`Merging audio files for ${speakersDir}`);
    }
    // read all top level directories in dir
    const speakers = await fsp.readdir(speakersDir);
    const tmpDir = fsJetpack.tmpDir();
    for (const speaker of speakers) {
      try {
        // read all files in dir
        const fullSpeakerDir = path.join(speakersDir, speaker);
        const files = await fsp.readdir(fullSpeakerDir);
        // now merge each file, that we know is audio, into one large audio file called merge using ffmpeg

        const command = ffmpeg();
        for (const f of files) {
          command.input(path.join(speakersDir, speaker, f));
        }
        const extension = path.parse(files[0]).ext;
        const mergeFile = path.join(speakersDir, speaker, `${speaker}-merged${extension}`);
        await new Promise<void>((resolve) => {
          command
            .on("end", resolve)
            .on("error", (err) => {
              logger.error(err);
              resolve();
            })
            .mergeToFile(mergeFile, tmpDir.path());
        });
      } catch (e) {
        logger.error(`Error merging files for speaker ${speaker}: ${e}`);
      }
    }
    tmpDir.remove();
    if (this.opts.verbose) {
      logger.info(`Finished merging audio files for ${speakersDir}`);
    }
  };
  splitAudioBySpeakers = async (inputFile: string, workingDirectory: string, response: DiarizedAudio) => {
    if (this.opts.verbose) {
      logger.info(`Splitting audio by speakers: ${inputFile}`);
    }
    const utterances = response?.utterances || [];
    const file = path.parse(inputFile);
    // create dir for speakers
    const speakersDir = path.join(workingDirectory, `${this.opts.client}-speakers`);
    await fsp.mkdir(speakersDir, { recursive: true });
    // create each individual speaker dir
    const allSpeakers = [
      ...new Set(utterances.map((utterance) => utterance.speaker).filter((l) => !Number.isNaN(l))),
    ] as number[];
    await Promise.all(
      allSpeakers.map((speaker) => fsp.mkdir(path.join(speakersDir, String(speaker)), { recursive: true })),
    );

    for (const utterance of utterances) {
      const speaker = utterance.speaker;
      const start = utterance.start;
      const end = utterance.end;
      const filename = `${start}-${end}`;
      const target = path.join(speakersDir, String(speaker), `${filename}${file.ext}`);
      await new Promise<void>((resolve) => {
        const command = ffmpeg();
        command
          .input(inputFile)
          .output(target)
          .setStartTime(start)
          .setDuration(end - start)
          .audioCodec("copy")
          .on("end", resolve)
          .on("error", (err) => {
            logger.error(err);
            resolve();
          })
          .run();
      });
    }

    if (this.opts.verbose) {
      logger.info(`Splitting audio by speakers complete: ${inputFile}`);
    }

    if (this.opts.mergeAudio) {
      await this.mergeAudioFiles(speakersDir);
    }
  };
}
