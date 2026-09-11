#!/usr/bin/env python3
"""Fetch CC0 textures + HDRI from Poly Haven into public/. Idempotent."""
import json, os, sys, urllib.request, urllib.error

ROOT = os.path.join(os.path.dirname(__file__), "..", "public")
API = "https://api.polyhaven.com/files/"

TEXTURES = {
    # name: (polyhaven asset, resolution)
    "grass":      ("leafy_grass", "1k"),
    "sand":       ("coast_sand_01", "1k"),
    "wood_light": ("ash_veneer", "1k"),
    "wood_dark":  ("black_walnut_veneer_01", "1k"),
    "wood_frame": ("american_walnut_veneer", "1k"),
    "bark":       ("bark_willow", "1k"),
    "castle":     ("castle_brick_02_white", "1k"),
    "cobble":     ("cobblestone_floor_04", "1k"),
}
HDRI = ("kloofendal_48d_partly_cloudy_puresky", "1k")
SKIES = {  # time-of-day / weather skies (all "puresky" domes, 1k)
    "day": "kloofendal_48d_partly_cloudy_puresky",
    "dawn": "kloppenheim_06_puresky",
    "dusk": "belfast_sunset_puresky",
    "night": "kloppenheim_02_puresky",
    "cloudy": "kloofendal_overcast_puresky",
    "rain": "overcast_soil_puresky",
    "rain_night": "kloppenheim_07_puresky",
}

WANT = {"diff": ["diffuse", "diff", "col"], "nor": ["nor_gl"], "rough": ["rough"], "arm": ["arm"], "ao": ["ao"]}


UA = {"User-Agent": "Mozilla/5.0 (ChessWonderland asset fetch)"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        return "cached"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return f"{os.path.getsize(dest)//1024} KB"


def pick(files, keys, res):
    for k, v in files.items():
        kl = k.lower()
        if any(kl == w or kl.startswith(w) for w in keys):
            if res in v and "jpg" in v[res]:
                return v[res]["jpg"]["url"]
    return None


def main():
    for local, (asset, res) in TEXTURES.items():
        try:
            files = get_json(API + asset)
        except urllib.error.HTTPError as e:
            print("SKIP", asset, e)
            continue
        got = []
        for slot, keys in WANT.items():
            url = pick(files, keys, res)
            if not url:
                continue
            if slot == "ao" and "arm" in got:
                continue
            dest = os.path.join(ROOT, "textures", local, f"{slot}.jpg")
            print(f"{local}/{slot}.jpg <- {asset}: {download(url, dest)}")
            got.append(slot)
        if not got:
            print("NOTHING for", asset, list(files.keys()))
    for local, asset in SKIES.items():
        files = get_json(API + asset)
        url = files["hdri"]["1k"]["hdr"]["url"]
        dest = os.path.join(ROOT, "hdr", f"{local}.hdr")
        print(f"hdr/{local}.hdr <-", asset, download(url, dest))


if __name__ == "__main__":
    main()
