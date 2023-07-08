# Audio Tools

Some tools to work with movie and audio files. This allows you to use either AssemblyAI or Deepgram to diarize your audio, and extract ust the portions of speech from a set of video or audio files for a given speaker.

## Usage

```bash
npx audio-training --help
```

## Example

```bash
npx audio-training --input my-video-file.mp4 --apiKey my_assemblyai_api_key --client assemblyai
```

It can also work recursively on a directory of files:

```bash
npx audio-training --input my-directory-of-files --apiKey my_assemblyai_api_key --client assemblyai
```
