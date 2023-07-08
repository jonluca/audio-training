import type { AudioProcessor, DiarizedAudio } from "./base.js";
import process from "process";
import * as dg from "@deepgram/sdk";
import type { AudioOpts } from "../opts.js";
import fs from "fs";
import mime from "mime-types";
import type { Utterance } from "./base.js";
const { Deepgram } = dg;
import type { Deepgram as DeepgramClient } from "@deepgram/sdk";

class DeepgramTranscriber implements AudioProcessor {
  static id: "deepgram";
  deepgram: DeepgramClient;
  opts: AudioOpts;

  constructor(opts: AudioOpts) {
    this.opts = opts;

    const key = process.env.DEEPGRAM_API_KEY || opts.apiKey;
    if (!key) {
      throw new Error("Deepgram API key not found");
    }
    this.deepgram = new Deepgram(key);
  }
  processAudio = async (file: string): Promise<DiarizedAudio> => {
    const mimeType = mime.lookup(file);
    if (!mimeType) {
      throw new Error(`Mime type not found for file ${file}`);
    }
    // Sending a ReadStream
    const audioSource = {
      stream: fs.createReadStream(file),
      mimetype: mimeType,
    };
    const response = await this.deepgram.transcription.preRecorded(audioSource, {
      punctuate: true,
      language: this.opts.language,
      diarize: true,
      utterances: true,
      smart_format: true,
    });

    const utterances = (response.results?.utterances || []).map((utterance) => {
      const { words, ...rest } = utterance;
      return {
        ...rest,
        words: words.map((word) => {
          return {
            word: word.word,
            start: word.start,
            end: word.end,
            confidence: word.confidence,
            speaker: word.speaker,
          };
        }),
      } as Utterance;
    });
    return {
      utterances,
      srt: response.toSRT(),
      vtt: response.toWebVTT(),
    };
  };
}
export default DeepgramTranscriber;
