import type { AudioProcessor, Utterance, Word } from "./base.js";
import process from "process";
import type { AudioOpts } from "../opts.js";
import axios from "axios";
import fs from "fs/promises";
import type { DiarizedAudio } from "./base.js";
import logger from "../logger.js";

export interface AssemblyAiResponse {
  id: string;
  language_model: string;
  acoustic_model: string;
  language_code: string;
  status: string;
  audio_url: string;
  text: string;
  words: AssemblyAiUtterance[];
  utterances: AssemblyAiUtterance[];
  confidence: number;
  audio_duration: number;
  punctuate: boolean;
  format_text: boolean;
  dual_channel: boolean;
  webhook_url: null;
  webhook_status_code: null;
  webhook_auth: boolean;
  webhook_auth_header_name: null;
  speed_boost: boolean;
  auto_highlights_result: null;
  auto_highlights: boolean;
  error?: any;
  audio_start_from: null;
  audio_end_at: null;
  word_boost: any[];
  boost_param: null;
  filter_profanity: boolean;
  redact_pii: boolean;
  redact_pii_audio: boolean;
  redact_pii_audio_quality: null;
  redact_pii_policies: null;
  redact_pii_sub: null;
  speaker_labels: boolean;
  content_safety: boolean;
  iab_categories: boolean;
  content_safety_labels: ContentSafetyLabels;
  iab_categories_result: ContentSafetyLabels;
  language_detection: boolean;
  custom_spelling: null;
  throttled: null;
  auto_chapters: boolean;
  summarization: boolean;
  summary_type: null;
  summary_model: null;
  custom_topics: boolean;
  topics: any[];
  speech_threshold: null;
  disfluencies: boolean;
  sentiment_analysis: boolean;
  chapters: null;
  sentiment_analysis_results: null;
  entity_detection: boolean;
  entities: null;
  summary: null;
  speakers_expected: null;
}

export interface ContentSafetyLabels {
  status: string;
  results: any[];
  summary: null;
}
export interface AssemblyAiWord {
  start: number;
  end: number;
  confidence: number;
  speaker: string;
  text: string;
}

export interface AssemblyAiUtterance {
  start: number;
  end: number;
  confidence: number;
  speaker: string;
  text: string;
  words: AssemblyAiWord[];
}

class AssemblyAITranscriber implements AudioProcessor {
  static id: "assemblyai";
  opts: AudioOpts;
  apiKey: string;

  constructor(opts: AudioOpts) {
    this.opts = opts;

    const key = process.env.ASSEMBLYAI_API_KEY || opts.apiKey;
    if (!key) {
      throw new Error("AssemblyAI API key not found");
    }
    this.apiKey = key;
  }

  private uploadFile = async (path: string): Promise<string | null> => {
    const data = await fs.readFile(path);
    const url = "https://api.assemblyai.com/v2/upload";

    try {
      const response = await axios.post(url, data, {
        headers: {
          "Content-Type": "application/octet-stream",
          Authorization: this.apiKey,
        },
      });

      if (response.status === 200) {
        return response.data["upload_url"];
      } else {
        logger.error(`Error: ${response.status} - ${response.statusText}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error: ${error}`);
      return null;
    }
  };

  processAudio = async (file: string): Promise<DiarizedAudio> => {
    const url = await this.uploadFile(file);
    if (!url) {
      throw new Error("Failed to upload file");
    }
    const response = await this.submitAudio(url);
    const utterances = (response.utterances ?? []).map((l) => {
      return {
        start: l.start / 1000,
        end: l.end / 1000,
        confidence: l.confidence,
        speaker: l.speaker,
        transcript: l.text,
        words: l.words.map((w) => {
          return {
            start: w.start / 1000,
            end: w.end / 1000,
            word: w.text,
            confidence: w.confidence,
            speaker: w.speaker,
          } as Word;
        }),
      } as Utterance;
    });

    return { utterances } as DiarizedAudio;
  };

  private submitAudio = async (audioUrl: string): Promise<AssemblyAiResponse> => {
    const headers = {
      authorization: this.apiKey,
      "content-type": "application/json",
    };

    // Send a POST request to the transcription API with the audio URL in the request body
    const response = await axios.post(
      "https://api.assemblyai.com/v2/transcript",
      {
        audio_url: audioUrl,
        speaker_labels: true,
        disfluencies: true,
        punctuate: true,
        format_text: true,
        // language_code: this.opts.language, // todo fix this so that languages map to assemblyai language codes
      },
      { headers },
    );

    // Retrieve the ID of the transcript from the response data
    const transcriptId = response.data.id;

    // Construct the polling endpoint URL using the transcript ID
    const pollingEndpoint = `https://api.assemblyai.com/v2/transcript/${transcriptId}`;

    let status = "processing";
    // Poll the transcription API until the transcript is ready
    while (status !== "completed" && status !== "error") {
      // Send a GET request to the polling endpoint to retrieve the status of the transcript
      const pollingResponse = await axios.get<AssemblyAiResponse>(pollingEndpoint, { headers });

      // Retrieve the transcription result from the response data
      const transcriptionResult = pollingResponse.data;

      status = transcriptionResult.status;
      // If the transcription is complete, return the transcript object
      if (transcriptionResult.status === "completed") {
        return transcriptionResult;
      }
      // If the transcription has failed, throw an error with the error message
      else if (transcriptionResult.status === "error") {
        throw new Error(`Transcription failed: ${transcriptionResult.error}`);
      }
      // If the transcription is still in progress, wait for a few seconds before polling again
      else {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    throw new Error("Transcription failed");
  };
}
export default AssemblyAITranscriber;
