// Renders the short to MP4 (H.264 + AAC) with headless Chromium and ffmpeg.
//
//   node render.mjs                         -> out/ai-ends-chat.mp4 (+ sfx.wav, subtitles.srt, vo-timing.txt)
//   node render.mjs --channel "@mychannel"  -> channel name on the end card
//   node render.mjs --voice vo.wav          -> mixes a voice-over in (default: audio/voice.wav, --no-voice to skip)
//   node render.mjs --music music.mp3       -> mixes a music bed at ~15 % of the voice level
//   node render.mjs --stills 3,12.5,26      -> PNG frames only, for checking
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'out');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));

if (!args.voice && !args['no-voice'] && existsSync(join(ROOT, 'audio/voice.wav'))) args.voice = join(ROOT, 'audio/voice.wav');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.otf': 'font/otf' };
const server = createServer(async (req, res) => {
  try {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT)) throw new Error('outside root');
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
const q = new URLSearchParams({ render: '1' });
if (args.channel) q.set('channel', args.channel);
await page.goto(`http://127.0.0.1:${port}/index.html?${q}`);
await page.waitForFunction('window.SHORT_READY === true');
const meta = await page.evaluate(() => ({ D: SHORT.DURATION, FPS: SHORT.FPS, sfx: SHORT.SFX, srt: SHORT.srt(), vo: SHORT.voScript() }));

const grab = t => page.evaluate(t => { renderFrame(t); return document.getElementById('c').toDataURL('image/jpeg', 0.95); }, t)
  .then(u => Buffer.from(u.slice(u.indexOf(',') + 1), 'base64'));

if (args.stills) {
  for (const s of String(args.stills).split(',')) {
    const t = +s;
    const png = await page.evaluate(t => { renderFrame(t); return document.getElementById('c').toDataURL('image/png'); }, t);
    await writeFile(join(OUT, `still-${t.toFixed(2)}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  console.log('stills written to', OUT);
} else {
  await writeFile(join(OUT, 'subtitles.srt'), meta.srt);
  await writeFile(join(OUT, 'vo-timing.txt'), meta.vo + '\n');
  await writeFile(join(OUT, 'sfx-cues.json'), JSON.stringify(meta.sfx, null, 1));
  const sfx = spawnSync('python3', [join(ROOT, 'sfx.py'), join(OUT, 'sfx-cues.json'), join(OUT, 'sfx.wav'), String(meta.D)], { stdio: 'inherit' });
  if (sfx.status !== 0) throw new Error('sfx.py failed');

  const video = join(OUT, 'video-only.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(meta.FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.round(meta.D * meta.FPS);
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const jpg = await grab(i / meta.FPS);
    if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 60 === 0) process.stdout.write(`\rframe ${i}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', c => (c === 0 ? r() : j(new Error('ffmpeg ' + c)))));
  console.log(`\nvideo done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // Mix: voice at 100 %, music ducked to ~15 %, SFX under the voice.
  const inputs = ['-i', video, '-i', join(OUT, 'sfx.wav')];
  const mix = ['[1:a]volume=0.8[s]'];
  const labels = ['[s]'];
  let n = 2;
  if (args.voice) { inputs.push('-i', args.voice); mix.push(`[${n++}:a]volume=1.0[v]`); labels.push('[v]'); }
  if (args.music) { inputs.push('-stream_loop', '-1', '-i', args.music); mix.push(`[${n++}:a]volume=0.15,afade=t=out:st=${meta.D - 1.5}:d=1.5[m]`); labels.push('[m]'); }
  mix.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=first,atrim=0:${meta.D}[a]`);
  const name = args.name || 'ai-ends-chat.mp4';
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix.join(';'),
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', join(OUT, name)], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('mux failed');
  console.log('wrote', join(OUT, name));
}
await browser.close();
server.close();
