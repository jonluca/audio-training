#!/usr/bin/env node

import { Diarization } from "./index.js";
import { opts } from "./opts.js";
import * as process from "process";
import logger from "./logger.js";

(async () => {
  try {
    const diarizer = new Diarization(opts);
    const outputsPath = await diarizer.diarizeAudio();
    logger.info(`Diarization complete! Outputs saved to:\n${outputsPath.join("\n")}`);
  } catch (e: any) {
    logger.error(`Error: ${e.message}`);
    process.exit(1);
  }
})();
