"""Synthesises the sound-effects track from the cue list exported by scene.js.

usage: python3 sfx.py sfx-cues.json sfx.wav DURATION
Cue types: pop, whoosh, ding, thud, glitch, buzz, click.
"""
import json
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(7)


def env(n, attack, decay):
    t = np.arange(n) / SR
    return np.minimum(1.0, t / max(attack, 1e-4)) * np.exp(-t / decay)


def sweep(f0, f1, dur):
    n = int(dur * SR)
    f = np.geomspace(f0, f1, n)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be an array (Hz per sample)."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    a = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def pop(vol):
    d = 0.09
    f0 = 700 * rng.uniform(0.85, 1.25)
    s = sweep(f0 * 1.8, f0, d) * env(int(d * SR), 0.002, 0.025)
    return 0.55 * vol * s


def whoosh(vol):
    d = 0.5
    n = int(d * SR)
    t = np.linspace(0, 1, n)
    shape = np.sin(np.pi * t ** 0.7) ** 2
    x = lowpass(rng.standard_normal(n), 300 + 4500 * shape)
    x = x - lowpass(x, 200)
    return 0.9 * vol * x * shape / (np.abs(x).max() + 1e-9)


def ding(vol):
    d = 1.6
    n = int(d * SR)
    t = np.arange(n) / SR
    f = 1318.5
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.7)
         + 0.45 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.25)
         + 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.08))
    return 0.35 * vol * s * np.minimum(1, t / 0.003)


def thud(vol):
    d = 0.4
    n = int(d * SR)
    body = sweep(140, 45, d) * env(n, 0.003, 0.12)
    click = lowpass(rng.standard_normal(n), 2500) * env(n, 0.001, 0.015)
    return vol * (0.9 * body + 0.6 * click)


def glitch(vol):
    d = 0.3
    n = int(d * SR)
    t = np.arange(n) / SR
    sq = np.sign(np.sin(2 * np.pi * 110 * t)) * 0.4 + rng.standard_normal(n) * 0.6
    crush = np.round(sq * 4) / 4
    gate = (np.floor(t * 40) % 3 != 1).astype(float)
    return 0.32 * vol * crush * gate * env(n, 0.002, 0.18)


def buzz(vol):
    d = 0.22
    n = int(d * SR)
    t = np.arange(n) / SR
    s = np.sign(np.sin(2 * np.pi * 150 * t)) * 0.5 + np.sin(2 * np.pi * 300 * t) * 0.5
    return 0.22 * vol * lowpass(s, 1800) * env(n, 0.003, 0.09)


def click(vol):
    d = 0.06
    n = int(d * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * 2200 * t) * env(n, 0.0005, 0.01) + 0.4 * rng.standard_normal(n) * env(n, 0.0005, 0.003)
    return 0.4 * vol * s


GEN = dict(pop=pop, whoosh=whoosh, ding=ding, thud=thud, glitch=glitch, buzz=buzz, click=click)


def main():
    cues = json.load(open(sys.argv[1]))
    dur = float(sys.argv[3])
    out = np.zeros((int(dur * SR) + SR, 2))
    for i, c in enumerate(cues):
        s = GEN[c['type']](c.get('vol', 1.0))
        start = int(c['t'] * SR)
        pan = 0.5 + 0.25 * np.sin(i * 2.1) if c['type'] == 'pop' else 0.5
        seg = out[start:start + len(s)]
        seg[:, 0] += s[:len(seg)] * np.sqrt(1 - pan) * 1.41
        seg[:, 1] += s[:len(seg)] * np.sqrt(pan) * 1.41
    out = np.tanh(out[:int(dur * SR)] * 1.1) * 0.9
    pcm = (out * 32767).astype('<i2')
    with wave.open(sys.argv[2], 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == '__main__':
    main()
