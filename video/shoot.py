"""Capture screenshots of the running Tally demo app (http://localhost:3100) with headless Chrome over CDP.
Signs in with the demo passcode first. Usage: .venv/bin/python shoot.py"""
import asyncio, base64, json, os, subprocess, time, urllib.request
import aiohttp

CH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
D = os.path.dirname(os.path.abspath(__file__))
BASE, PORT = "http://localhost:3100", 9335
PASS = dict(l.split("=", 1) for l in open(f"{D}/.env.demo").read().splitlines() if "=" in l)["DASHBOARD_PASSCODE"]
os.makedirs(f"{D}/shots", exist_ok=True)

SHOTS = [
    dict(name="home", path="/"),
    dict(name="how", path="/how-it-works"),
    dict(name="overview", path="/dashboard", auth=True),
    dict(name="pool", path="/dashboard/pool", auth=True),
    dict(name="seller", path="/dashboard/seller", auth=True),
    dict(name="activity", path="/dashboard/activity", auth=True),
    dict(name="playground", path="/dashboard/playground", auth=True),
]

SIGNIN = """(()=>{const i=document.querySelector('input[type=password]'); if(!i) return 'none';
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, %s);
 i.dispatchEvent(new Event('input',{bubbles:true}));
 setTimeout(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Sign in').click(),150); return 'ok'})()"""

class CDP:
    def __init__(self, ws): self.ws, self.n = ws, 0
    async def send(self, method, **params):
        self.n += 1; i = self.n
        await self.ws.send_json(dict(id=i, method=method, params=params))
        while True:
            m = await self.ws.receive_json()
            if m.get("id") == i:
                if "error" in m: raise RuntimeError(m["error"])
                return m.get("result", {})
    async def js(self, expr):
        r = await self.send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if "exceptionDetails" in r: raise RuntimeError(r["exceptionDetails"])
        return r["result"].get("value")

async def main():
    chrome = subprocess.Popen([CH, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--remote-debugging-port={PORT}",
        "--window-size=1600,900", "--force-device-scale-factor=1", f"--user-data-dir={D}/.chrome", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try: tabs = json.load(urllib.request.urlopen(f"http://localhost:{PORT}/json")); break
            except Exception: time.sleep(0.2)
        ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
        async with aiohttp.ClientSession() as s, s.ws_connect(ws_url, max_msg_size=0) as ws:
            c = CDP(ws)
            await c.send("Page.enable")
            await c.send("Emulation.setDeviceMetricsOverride", width=1600, height=900, deviceScaleFactor=1, mobile=False)
            await c.send("Page.navigate", url=BASE + "/dashboard"); await asyncio.sleep(3)
            print("signin:", await c.js(SIGNIN % json.dumps(PASS))); await asyncio.sleep(3)
            for sh in SHOTS:
                await c.send("Page.navigate", url=BASE + sh["path"]); await asyncio.sleep(3.5)
                await c.js("(()=>{const st=document.createElement('style');st.textContent='nextjs-portal{display:none!important}';document.head.appendChild(st)})()")
                h = max(await c.js("document.documentElement.scrollHeight"), 900)
                shot = await c.send("Page.captureScreenshot", format="png", captureBeyondViewport=True, clip=dict(x=0, y=0, width=1600, height=h, scale=1))
                open(f"{D}/shots/{sh['name']}.png", "wb").write(base64.b64decode(shot["data"]))
                print(sh["name"], h)
    finally:
        chrome.terminate()

asyncio.run(main())
