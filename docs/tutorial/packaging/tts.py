import json, sys, numpy as np, soundfile as sf
from kokoro import KPipeline
voice = sys.argv[1] if len(sys.argv) > 1 else "af_heart"
pipe = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")
out = {}
for s in json.load(open("scenes.json")):
    audio = np.concatenate([a for _, _, a in pipe(s["text"], voice=voice, speed=1.0)])
    sf.write(f"audio/{s['id']}.wav", audio, 24000)
    out[s["id"]] = round(len(audio) / 24000, 2)
    print(s["id"], out[s["id"]], flush=True)
json.dump(out, open("durations.json", "w"), indent=1)
