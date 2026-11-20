import json, numpy as np, soundfile as sf
from kokoro import KPipeline
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
for s in json.load(open("extra.json")):
    audio = np.concatenate([a for _, _, a in pipe(s["text"], voice="af_heart", speed=1.0)])
    sf.write(f"audio/{s['id']}.wav", audio, 24000)
    print(s["id"], round(len(audio) / 24000, 2))
