export interface Word {
  start: number;
  end: number;
  word: string;
  confidence: number;
  speaker: number | string;
}

export interface Utterance {
  /**
   * Start time (in seconds) from the beginning of the audio stream.
   */
  start: number;
  /**
   * End time (in seconds) from the beginning of the audio stream.
   */
  end: number;
  /**
   * Floating point value between 0 and 1 that indicates overall transcript
   * reliability. Larger values indicate higher confidence.
   */
  confidence: number;
  /**
   *  Transcript for the audio segment being processed.
   */
  transcript: string;
  /**
   * Object containing each word in the transcript, along with its start time
   * and end time (in seconds) from the beginning of the audio stream, and a confidence value.
   */
  words: Array<Word>;
  /**
   * Integer indicating the predicted speaker of the majority of words
   * in the utterance who is saying the words being processed.
   */
  speaker: number | string;
}

export interface DiarizedAudio {
  utterances: Array<Utterance>;
  srt?: string;
  vtt?: string;
}
export interface AudioProcessor {
  processAudio(file: string): Promise<DiarizedAudio>;
}
