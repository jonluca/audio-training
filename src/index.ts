import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as fsp from "fs/promises";
import { Deepgram } from "@deepgram/sdk";
import * as process from "process";
import mime from "mime-types";
import { glob } from "glob";
import type { AudioOpts } from "./opts.js";
import * as path from "path";
import type { PrerecordedTranscriptionResponse } from "@deepgram/sdk/dist/types/index.js";

export class Diarization {
  opts: AudioOpts;
  deepgram: Deepgram;
  constructor(opts: AudioOpts) {
    this.opts = opts;

    const apiKey = this.opts.apiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("Deepgram API key not found");
    }
    this.deepgram = new Deepgram(apiKey);

    try {
      ffmpeg.setFfmpegPath(ffmpegPath);
    } catch (err) {
      throw new Error("ffmpeg not found");
    }
  }
  diarizeAudio = async () => {
    const inputDirectoryOrFile = this.opts.input;
    const isDirectory = fs.lstatSync(inputDirectoryOrFile).isDirectory();
    const files = isDirectory ? await glob(inputDirectoryOrFile) : [inputDirectoryOrFile];
    await Promise.all(files.map((file) => this.diarizeFile(file)));
  };

  private processTranscriptionResponse = (response: PrerecordedTranscriptionResponse) => {
    const srt = response.toSRT();
    const vtt = response.toWebVTT();
    const output = {
      srt,
      vtt,
      err_code: response.err_code,
      err_msg: response.err_msg,
      request_id: response.request_id,
      metadata: response.metadata,
      results: response.results,
    } as const;
    return output;
  };

  diarizeFile = async (inputFile: string) => {
    const mimeType = mime.lookup(inputFile);
    if (!mimeType) {
      console.error("Mime type not found for file: ", inputFile);
      return;
    }

    const file = path.parse(inputFile);
    const destinationFilename = `${file.name}.json`;
    const outputFile = path.join(file.dir, destinationFilename);
    // dont reprocess if file exists
    if (fs.existsSync(outputFile)) {
      const contents = await fsp.readFile(outputFile, { encoding: "utf-8" });
      const output = JSON.parse(contents);
      await this.splitAudioBySpeakers(inputFile, output);
    }
    // Sending a ReadStream
    const audioSource = {
      stream: fs.createReadStream(inputFile),
      mimetype: mimeType,
    };
    const response = await this.deepgram.transcription.preRecorded(audioSource, {
      punctuate: true,
      language: this.opts.language,
      diarize: true,
      utterances: true,
    });
    const output = this.processTranscriptionResponse(response);

    await fsp.writeFile(outputFile, JSON.stringify(output, null, 2));
    await this.splitAudioBySpeakers(inputFile, output);
  };

  splitAudioBySpeakers = async (
    inputFile: string,
    response: ReturnType<Diarization["processTranscriptionResponse"]>,
  ) => {
    const utterances = response.results?.utterances || [];
    const file = path.parse(inputFile);
    // create dir for speakers
    const speakersDir = path.join(file.dir, `${file.name}-speakers`);
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
      const target = path.join(speakersDir, String(speaker), `${filename}.${file.ext}`);
      await new Promise<void>((resolve) => {
        const command = ffmpeg();
        command
          .input(this.opts.input)
          .setStartTime(start)
          .setDuration(end - start)
          .output(target)
          .on("end", resolve)
          .on("error", (err) => {
            console.error(err);
            resolve();
          })
          .run();
      });
    }
  };
}
