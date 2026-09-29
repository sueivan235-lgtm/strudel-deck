"""Download the sample fixtures the browser tests serve instead of GitHub (about 11 MB).

python3 test/fetch_fixtures.py
"""
import json, pathlib, urllib.request

FIX = pathlib.Path(__file__).parent / 'fixtures'
RAW = 'https://raw.githubusercontent.com/'
DIRT = RAW + 'tidalcycles/Dirt-Samples/master/'
FOLDERS = ['bd', 'hc', 'ho', 'cr', 'cc', 'cp', 'sn', 'lt', 'mt', 'ht', 'hardkick', 'gabbalouder', 'industrial',
           'metal', 'noise2', 'amencutup', 'stab', 'hoover', 'rave']
MAPS = ['tidal-drum-machines', 'piano', 'Dirt-Samples', 'EmuSP12', 'vcsl', 'mridangam']

def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

FIX.mkdir(exist_ok=True)
dirt = json.loads(get(DIRT + 'strudel.json'))
(FIX / 'dirt.json').write_text(json.dumps(dirt))
for name in MAPS:
    (FIX / f'dough-{name}.json').write_bytes(get(RAW + f'felixroos/dough-samples/main/{name}.json'))
(FIX / 'tidal-drum-machines-alias.json').write_bytes(get(RAW + 'todepond/samples/main/tidal-drum-machines-alias.json'))
n = 0
for folder in FOLDERS:
    for rel in dirt.get(folder, []):
        dest = FIX / 'dirt' / rel
        if dest.exists():
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(get(DIRT + urllib.request.quote(rel)))
        n += 1
print(f'fixtures ready in {FIX} ({n} samples downloaded)')
