# Video tutorial

Remakes `~/Videos/Ironline_tutorial.mp4`: a narrated walkthrough from new customer to shop floor.

1. Edit the narration in `scenes.json`, one entry per scene.
2. Make the voice clips with Kokoro (af_heart; other voices: am_michael, bf_emma, bm_george, af_bella):
   `cd docs/tutorial && mkdir -p audio && ~/kokoro-tts/.venv/bin/python tts.py af_heart`
   This writes `audio/*.wav` and `durations.json`.
3. With the API and web app running, record the browser (a Chromium window opens for about 3 minutes):
   `node record.mjs`
   Each scene stays on screen as long as its narration. This writes `video/*.webm` and `marks.json`.
4. Put the narration on the video at each scene's start time and export the MP4 with ffmpeg (see the history for the exact command; it uses `adelay` per clip, `amix`, and scales 1600×900 up to 1920×1080).

Each recording creates a new demo customer "Brightline Brackets" with a quote, order and job in the demo shop.

## Modules video

`modules/` remakes `~/Videos/Ironline_modules_tutorial.mp4` (about 4 minutes): quality, inventory,
purchasing and reports. Same steps as above, run inside `modules/` (copy `tts.py` in first). This
recording only looks and clicks: nothing is saved, so the demo data stays as it is. It expects the
demo records from 2026-11-19 (DMW-1040 drawing and plan, J-00002 readings, lots, PO-00001, the
"Monthly sales" report).
