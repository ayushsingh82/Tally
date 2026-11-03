"""Builds the Tally demo video: Chrome-rendered cards, app screenshots, edge-tts voice, ffmpeg.
Usage: .venv/bin/python build.py [edge-tts voice]   (default: en-US-EmmaNeural)"""
import html, json, os, re, subprocess, sys
from PIL import Image

CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
D = os.path.dirname(os.path.abspath(__file__)); os.chdir(D)
EDGE = os.path.join(D, ".venv/bin/edge-tts")
VOICE = sys.argv[1] if len(sys.argv) > 1 else "en-US-EmmaNeural"
RATE = "-6%"; FPS = 30; GAP = 0.5
for d in ("audio", "cards", "build"): os.makedirs(d, exist_ok=True)
scenes = json.load(open("scenes.json"))

MARK = '''<svg viewBox="0 0 40 40" width="{W}" height="{W}"><rect width="40" height="40" rx="10" fill="#2563eb"/><text x="20" y="29.5" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="27" fill="#fff">T</text><circle cx="32" cy="8.5" r="3.2" fill="none" stroke="#fff" stroke-width="1.8"/></svg>'''
mark = lambda w: MARK.replace("{W}", str(w))
CSS = """*{box-sizing:border-box;margin:0}body{width:1600px;height:900px;background:%s;color:#0a0a0a;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;position:relative;overflow:hidden}
.tag{display:inline-flex;align-items:center;gap:10px;font:600 20px ui-monospace,Menlo,monospace;letter-spacing:.2em;padding:10px 20px;border-radius:999px;background:rgba(37,99,235,.10);border:1px solid rgba(37,99,235,.55);color:#1d4ed8;white-space:nowrap}
.bad{background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.5);color:#b91c1c}
.dot{width:10px;height:10px;border-radius:50%%;background:currentColor}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 40px;gap:28px}
h1{font-family:Georgia,serif;font-size:170px;letter-spacing:-.05em;font-weight:700;line-height:1}
p.sub{font-size:44px;color:#52525b;max-width:1100px;line-height:1.3}
h2{font-family:Georgia,serif;font-size:68px;letter-spacing:-.03em}
.mark{filter:drop-shadow(0 20px 50px rgba(37,99,235,.35))}
ul{list-style:none;display:flex;flex-direction:column;gap:20px;text-align:left}
li{font-size:40px;color:#18181b;padding:24px 34px;border:1px solid rgba(0,0,0,.12);border-radius:16px;background:#ffffff;display:flex;gap:22px;align-items:center;min-width:820px}
li:before{content:'';width:14px;height:14px;border-radius:50%%;background:#dc2626;flex:none}
.grid{position:absolute;inset:0;background-image:linear-gradient(to right,rgba(0,0,0,.05) 1px,transparent 1px),linear-gradient(to bottom,rgba(0,0,0,.05) 1px,transparent 1px);background-size:64px 64px;-webkit-mask-image:radial-gradient(ellipse at center,#000,transparent 70%%)}
.bar{position:absolute;left:0;right:0;bottom:0;height:104px;padding:0 60px;display:flex;align-items:center;gap:24px;background:linear-gradient(to top,rgba(255,255,255,.97) 70%%,rgba(255,255,255,0))}
.brand{margin-left:auto;display:flex;align-items:center;gap:14px;font-size:34px;font-weight:700;letter-spacing:-.03em}
.cap{font-size:40px;font-weight:600;letter-spacing:-.02em}
.steps{display:flex;align-items:stretch;gap:12px}
.step{width:310px;padding:28px 24px;border:1px solid rgba(0,0,0,.14);border-radius:20px;background:#ffffff;text-align:left;display:flex;flex-direction:column;gap:18px}
.num{width:56px;height:56px;border-radius:50%%;background:#2563eb;color:#ffffff;font-size:32px;font-weight:700;display:flex;align-items:center;justify-content:center}
.step p{font-size:29px;line-height:1.25}
.arrow{align-self:center;font-size:38px;color:#2563eb}
"""
page = lambda body, bg="#ffffff": f"<html><head><style>{CSS % bg}</style></head><body>{body}</body></html>"
tagh = lambda t, c="": f'<span class="tag {c}"><span class="dot"></span>{html.escape(t)}</span>' if t else ""

def render(name, doc, transparent=False):
    open(f"cards/{name}.html", "w").write(doc)
    a = [CH, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--window-size=1600,900", "--force-device-scale-factor=1"]
    if transparent: a.append("--default-background-color=00000000")
    subprocess.run(a + [f"--screenshot=cards/{name}.png", f"file://{D}/cards/{name}.html"], capture_output=True, check=True)

dur = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).decode())
ff = lambda *a: subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)

def srt_time(t):
    h, m, s = int(t // 3600), int(t % 3600 // 60), t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")

clips, cues, clock = [], [], 0.0
for s in scenes:
    i = s["id"]
    subprocess.run([EDGE, "--voice", VOICE, f"--rate={RATE}", "--text", s.get("tts", s["say"]), "--write-media", f"audio/{i}.mp3"], check=True, capture_output=True)
    ff("-i", f"audio/{i}.mp3", "-ar", "44100", "-ac", "2", f"audio/{i}.wav"); os.remove(f"audio/{i}.mp3")
    speech = dur(f"audio/{i}.wav"); d = speech + GAP + (0.4 if s["kind"] == "title" else 0)
    vf_tail = f"scale=1920:1080:flags=lanczos,fade=t=in:st=0:d=0.35,fade=t=out:st={d-0.35:.2f}:d=0.35,format=yuv420p"
    if s["kind"] == "title":
        render(i, page(f'<div class="grid"></div><div class="center"><div class="mark">{mark(150)}</div><h1>{s["title"]}</h1><p class="sub">{html.escape(s["sub"])}</p></div>'))
        inp = ["-loop", "1", "-t", f"{d:.2f}", "-r", str(FPS), "-i", f"cards/{i}.png"]; fc = f"[0:v]{vf_tail}[v]"
    elif s["kind"] == "list":
        li = "".join(f"<li>{html.escape(x)}</li>" for x in s["items"])
        render(i, page(f'<div class="grid"></div><div class="center" style="gap:34px">{tagh(s["tag"], "bad")}<h2>{html.escape(s["title"])}</h2><ul>{li}</ul></div>'))
        inp = ["-loop", "1", "-t", f"{d:.2f}", "-r", str(FPS), "-i", f"cards/{i}.png"]; fc = f"[0:v]{vf_tail}[v]"
    elif s["kind"] == "steps":
        st = '<div class="arrow">&rarr;</div>'.join(f'<div class="step"><div class="num">{n}</div><p>{html.escape(t)}</p></div>' for n, t in s["items"])
        render(i, page(f'<div class="grid"></div><div class="center" style="gap:44px">{tagh(s["tag"])}<h2>{html.escape(s["title"])}</h2><div class="steps">{st}</div></div>'))
        inp = ["-loop", "1", "-t", f"{d:.2f}", "-r", str(FPS), "-i", f"cards/{i}.png"]; fc = f"[0:v]{vf_tail}[v]"
    else:
        im = Image.open(s["img"]).convert("RGB")
        if im.height < 900:
            im = im.crop((200, 0, 1400, im.height))  # trim the empty page margins, then zoom to fill the frame
            k = min(1600 / im.width, 780 / im.height); im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
            canvas = Image.new("RGB", (1600, 900), "#ffffff"); canvas.paste(im, ((1600 - im.width) // 2, max((900 - 104 - im.height) // 2, 0)))
            s = {**s, "img": f"build/{i}-padded.png"}; canvas.save(s["img"])
        render(i + "-bar", page(f'<div class="bar">{tagh(s["tag"])}<div class="cap">{html.escape(s["cap"])}</div><div class="brand">{mark(44)}Tally</div></div>', "transparent"), True)
        inp = ["-loop", "1", "-t", f"{d:.2f}", "-r", str(FPS), "-i", s["img"], "-loop", "1", "-t", f"{d:.2f}", "-r", str(FPS), "-i", f"cards/{i}-bar.png"]
        pm = s.get("pan", 100000)
        y = f"min(max(ih-900,0),{pm})*clip((t-0.7)/({d:.2f}-2.0),0,1)"
        fc = f"[0:v]crop=1600:900:0:'{y}'[a];[a][1:v]overlay=0:0,{vf_tail}[v]"
    ff(*inp, "-i", f"audio/{i}.wav", "-filter_complex", fc,
       "-map", "[v]", "-map", f"{2 if s['kind'] == 'shot' else 1}:a", "-af", f"apad=pad_dur={GAP+0.4}", "-t", f"{d:.2f}",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", str(FPS), "-c:a", "aac", "-b:a", "160k", f"build/{i}.mp4")
    clips.append(f"build/{i}.mp4")
    sents = [x for x in re.split(r"(?<=[.!?:])\s+", s["say"]) if x]; tot = sum(len(x) for x in sents); t = clock + 0.35
    for x in sents:
        span = speech * len(x) / tot; cues.append((t, t + span, x)); t += span
    clock += d

open("build/list.txt", "w").write("".join(f"file '{os.path.basename(c)}'\n" for c in clips))
ff("-f", "concat", "-safe", "0", "-i", "build/list.txt", "-c:v", "copy", "-af", "highpass=f=70,lowpass=f=9000,loudnorm=I=-17:TP=-2:LRA=7", "-c:a", "aac", "-b:a", "192k", "Tally-Demo.mp4")
open("Tally-Demo.srt", "w").write("".join(f"{n}\n{srt_time(a)} --> {srt_time(b)}\n{x}\n\n" for n, (a, b, x) in enumerate(cues, 1)))
print(f"done: {clock:.1f}s, voice {VOICE}")
