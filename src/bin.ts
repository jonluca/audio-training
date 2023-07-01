#!/usr/bin/env node

import { Diarization } from "./index.js";
import { opts } from "./opts.js";
import * as process from "process";

(async () => {
  try {
    const diarizer = new Diarization(opts);
    const outputPath = await diarizer.diarizeAudio();
    console.log(`Output file: ${outputPath}`);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();
