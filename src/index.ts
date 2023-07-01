import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import { Deepgram } from "@deepgram/sdk";
import * as process from "process";
import mime from "mime-types";
import { glob } from "glob";
import type { AudioOpts } from "./opts.js";

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
    const inputDirectoryOrFile = this.opts.file;
    const isDirectory = fs.lstatSync(inputDirectoryOrFile).isDirectory();
    const files = isDirectory ? await glob(inputDirectoryOrFile) : [inputDirectoryOrFile];
    await Promise.all(files.map((file) => this.diarizeFile(file)));
  };

  diarizeFile = async (inputFile: string) => {
    const mimeType = mime.lookup(inputFile);
    if (!mimeType) {
      console.error("Mime type not found for file: ", inputFile);
      return;
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
  };
}
