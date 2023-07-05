import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { path as ffprobePath } from "@ffprobe-installer/ffprobe";
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
import pMap from "p-map";

export class Diarization {
  opts: AudioOpts;
  deepgram: Deepgram;
  EXTRACTED_AUDIO_SUFFIX = "_diarization_extracted_audio";
  constructor(opts: AudioOpts) {
    this.opts = opts;

    const apiKey = this.opts.apiKey || process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      throw new Error("Deepgram API key not found");
    }
    this.deepgram = new Deepgram(apiKey);

    try {
      ffmpeg.setFfmpegPath(ffmpegPath);
      ffmpeg.setFfprobePath(ffprobePath);
    } catch (err) {
      throw new Error("ffmpeg not found");
    }
  }
  diarizeAudio = async () => {
    const inputDirectoryOrFile = this.opts.input;
    const isDirectory = fs.lstatSync(inputDirectoryOrFile).isDirectory();
    const files = isDirectory ? await glob(`${inputDirectoryOrFile}/**`, { nodir: true }) : [inputDirectoryOrFile];
    const filteredFiles = files.filter((file) => {
      return !file.includes(`${this.EXTRACTED_AUDIO_SUFFIX}.`) && !file.includes(`-speakers/`);
    });
    await pMap(
      filteredFiles,
      async (file) => {
        try {
          await this.diarizeFile(file);
        } catch (e) {
          console.error(`Error processing file ${file}: ${e}`);
        }
      },
      {
        concurrency: 8,
      },
    );
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

  private convertVideoFileToAudio = async (file: string) => {
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
      console.warn("Multiple audio streams found, reencoding all into single stream");
    }
    const parsedFile = path.parse(file);
    const extension = isMultiStream ? "aac" : audioStream[0].codec_name;
    const outputFileName = `${parsedFile.dir}/${parsedFile.name}${this.EXTRACTED_AUDIO_SUFFIX}.${extension}`;
    await new Promise<void>((resolve) => {
      const command = ffmpeg();
      command
        .input(file)
        .output(outputFileName)
        .noVideo()
        .audioCodec(isMultiStream ? "aac" : "copy")
        .on("end", resolve)
        .on("error", (err) => {
          console.error(err);
          resolve();
        })
        .run();
    });
    return outputFileName;
  };

  diarizeFile = async (file: string) => {
    let mimeType = mime.lookup(file);
    if (!mimeType) {
      console.error("Mime type not found for file: ", file);
      return;
    }

    let inputFile = file;

    if (mimeType.startsWith("video")) {
      inputFile = await this.convertVideoFileToAudio(file);
      mimeType = mime.lookup(inputFile);
      if (!mimeType) {
        console.error("Mime type not found for file: ", file);
        return;
      }
    }

    const parsedFile = path.parse(inputFile);
    const destinationFilename = `${parsedFile.name}.json`;
    const outputFile = path.join(parsedFile.dir, destinationFilename);
    // dont reprocess if file exists
    if (fs.existsSync(outputFile)) {
      const contents = await fsp.readFile(outputFile, { encoding: "utf-8" });
      const output = JSON.parse(contents);
      await this.splitAudioBySpeakers(inputFile, output);
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
      smart_format: true,
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
            console.error(err);
            resolve();
          })
          .run();
      });
    }
  };
}
