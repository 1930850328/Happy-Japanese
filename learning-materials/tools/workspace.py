#!/usr/bin/env python3
"""Portable local course workspace. Run from any directory; no application secrets/services."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache'
MATERIALS = ROOT / '01-materials'
TESTS = ROOT / '03-test-set'
ROUND = ROOT / '04-evaluation/round-05'
VENV = ROOT / '.venv'
PYTHON = VENV / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def sha(data):
    return hashlib.sha256(data).hexdigest()

def run(args):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', HJ_COURSE_PYTHON=str(PYTHON))
    print('+ ' + ' '.join(map(str, args)), flush=True)
    subprocess.run(list(map(str, args)), cwd=ROOT, env=env, check=True)

def require_setup():
    if not PYTHON.is_file() or not (ROOT / 'node_modules/kuromoji/package.json').is_file():
        raise ValueError('Run setup first with Python 3.10+ and Node 20+.')

def checked(data, expected, label):
    if sha(data) != expected:
        raise ValueError('Source hash mismatch (not replaced): ' + label)
    return data

def cached(path, expected):
    if not path.exists():
        return False
    checked(path.read_bytes(), expected, str(path))
    return True

def save(path, data, expected):
    checked(data, expected, str(path))
    if cached(path, expected):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + '.part')
    partial.write_bytes(data)
    partial.replace(path)

def request(url):
    u = urlsplit(url)
    if u.scheme != 'https':
        raise ValueError('Expected HTTPS source')
    url = urlunsplit((u.scheme, u.netloc, quote(u.path, safe='/%:@'), quote(u.query, safe='=&%'), ''))
    with urlopen(Request(url, headers={'User-Agent': 'Happy-Japanese-course-research/1.0'}), timeout=45) as response:
        return response.read()

def fetch(job):
    url, path, expected = job
    if not cached(path, expected):
        save(path, request(url), expected)
        print('Downloaded and verified: ' + path.name, flush=True)

def material_url(item):
    # GitHub blob URLs in the existing manifest point to individual HTML sources.
    # Fetch only required files rather than the repository's media-heavy ZIP.
    url = item['url']
    if url.startswith('https://github.com/') and '/blob/' in url:
        url = url.replace('https://github.com/', 'https://raw.githubusercontent.com/', 1).replace('/blob/', '/', 1)
    return url

def download_materials():
    manifest = read(MATERIALS / 'sources-manifest.json')
    jobs = [(material_url(x), MATERIALS / x['path'], x['sha256']) for x in manifest['files']]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, jobs))

def fetch_materials():
    download_materials()
    # These are generated from originals, not separately maintained copies.
    run([PYTHON, MATERIALS / 'tools/build.py'])

def setup():
    if sys.version_info < (3, 10):
        raise ValueError('Use Python 3.10+ (for example python3.11 tools/workspace.py setup).')
    npm, node = shutil.which('npm'), shutil.which('node')
    if not npm or not node:
        raise ValueError('Install Node.js 20+ including npm first.')
    major = int(subprocess.check_output([node, '-p', 'process.versions.node.split(".")[0]'], text=True).strip())
    if major < 20:
        raise ValueError('Node.js 20+ is required.')
    if not PYTHON.exists():
        run([sys.executable, '-m', 'venv', VENV])
    run([PYTHON, '-m', 'pip', 'install', '--index-url', 'https://pypi.org/simple', '--disable-pip-version-check', '--timeout', '30', '-r', MATERIALS / 'tools/requirements.txt'])
    run([npm, 'ci', '--ignore-scripts', '--workspaces=false', '--registry=https://registry.npmjs.org', '--prefix', ROOT])
    fetch_materials()

def check():
    require_setup()
    run([PYTHON, MATERIALS / 'tools/build.py', '--check'])
    run([PYTHON, MATERIALS / 'vocabulary-scope/build.py', '--check'])
    run([PYTHON, ROOT / '02-course-design/tools/review.py'])
    run(['node', ROOT / '02-course-design/tools/context-review.cjs'])
    run([PYTHON, TESTS / 'tools/validate.py', '--metadata-only'])

def regression(current=False):
    require_setup()
    if current:
        check()
    CACHE.mkdir(exist_ok=True)
    output = CACHE / ('current-regression.json' if current else 'round-05-replay.json')
    args = ['node', ROUND / 'audit.cjs', ROOT, ROUND / 'coverage-features.json', output, '--features']
    if current:
        args.append('--current')
    run(args)
    if not current:
        expected, actual = read(ROUND / 'lexical-results.json'), read(output)
        for key in ['sizes', 'samples', 'works', 'genres', 'lexical_proxy_50_50']:
            if expected[key] != actual[key]:
                raise ValueError('Historical replay differs: ' + key)
        print('PASS: all16 sample counts and8 work scores match the original-text run.')
    print('Result: ' + str(output))

def fetch_tests():
    require_setup()
    assets = CACHE / 'test-assets'
    sources, samples = read(TESTS / 'sources.json'), read(TESTS / 'samples.json')
    jobs = [(s['subtitle']['raw_url'], assets / s['subtitle']['file_name'], s['subtitle']['sha256']) for s in sources if 'subtitle' in s]
    jobs += [(p['image_url'], assets / p['file_name'], p['sha256']) for s in samples for p in s['locator'].get('pages', [])]
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(fetch, jobs))
    run([PYTHON, TESTS / 'tools/validate.py', '--metadata-only', '--subtitle-dir', assets, '--image-dir', assets])
    subtitle_count = sum('subtitle' in source for source in sources)
    image_count = sum(len(sample['locator'].get('pages', [])) for sample in samples)
    print(f'{subtitle_count} subtitle files and {image_count} external manga images verified; originals remain local.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['setup', 'check', 'regression', 'fetch-materials', 'fetch-tests'])
    parser.add_argument('--current', action='store_true', help='Compare current course on exposed regression samples, never as a new holdout score.')
    args = parser.parse_args()
    if args.current and args.action != 'regression':
        parser.error('--current requires regression')
    if args.action == 'setup':
        setup()
    else:
        require_setup()
        if args.action == 'regression':
            regression(args.current)
        else:
            {'check': check, 'fetch-materials': fetch_materials, 'fetch-tests': fetch_tests}[args.action]()

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit('FAILED: ' + str(error))
