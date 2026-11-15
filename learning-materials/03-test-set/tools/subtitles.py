"""Parse the selected SRT sources without deleting dialogue or speaker labels."""
import re

STAMP = re.compile(r'^(\d{2}):(\d{2}):(\d{2}),(\d{3})$')


def milliseconds(value):
    match = STAMP.fullmatch(value)
    if not match:
        raise ValueError('Invalid SRT time: ' + value)
    h, m, s, ms = map(int, match.groups())
    if m >= 60 or s >= 60:
        raise ValueError('Invalid SRT clock: ' + value)
    return ((h * 60 + m) * 60 + s) * 1000 + ms


def parse_srt(raw):
    text = raw.decode('utf-8-sig').replace('\r\n', '\n')
    lines = text.splitlines()
    cues = []
    start = 0
    while start < len(lines):
        if not lines[start].strip():
            start += 1
            continue
        end = start
        while end < len(lines) and lines[end].strip():
            end += 1
        block = lines[start:end]
        if len(block) < 3 or not block[0].isdigit():
            raise ValueError(f'Malformed SRT block at line {start + 1}')
        times = block[1].split(' --> ')
        if len(times) != 2 or milliseconds(times[0]) > milliseconds(times[1]):
            raise ValueError(f'Invalid cue interval at line {start + 2}')
        body = '\n'.join(block[2:])
        # Some supplied SRTs retain ASS layout tags; remove only explicit tags.
        body = re.sub(r'\{\\[^}]*\}', '', body)
        cues.append(dict(number=int(block[0]), start=times[0], end=times[1],
                         source_lines=[start + 1, end], text=body))
        start = end + 1
    numbers = [c['number'] for c in cues]
    if not cues or len(numbers) != len(set(numbers)) or numbers != sorted(numbers):
        raise ValueError('Empty, duplicate or unordered cue IDs')
    return cues


def select(cues, first, last):
    result = [c for c in cues if first <= c['number'] <= last]
    if [c['number'] for c in result] != list(range(first, last + 1)):
        raise ValueError('Incomplete selected cue range')
    return result


def reading_text(cues):
    return '\n'.join(c['text'] for c in cues).strip() + '\n'
