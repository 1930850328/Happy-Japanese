"""Exercise cross-device replay and failure boundaries without application services."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ROUND = ROOT / '04-evaluation/round-05'
spec = importlib.util.spec_from_file_location('course_workspace', ROOT / 'tools/workspace.py')
workspace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workspace)

class Portability(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='happy japanese test ')
        self.directory = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def audit(self, input_path=None, learning=None, extra=()):
        env = dict(os.environ, HJ_COURSE_PYTHON=sys.executable)
        return subprocess.run(['node', str(ROUND / 'audit.cjs'), str(learning or ROOT),
                               str(input_path or ROUND / 'coverage-features.json'),
                               str(self.directory / 'result.json'), '--features', *extra],
                              capture_output=True, text=True, env=env)

    def copy_frozen_inputs(self):
        paths = set(workspace.read(ROUND / 'run.json')['files_before_evaluation'])
        paths.update(['tools/coverage_vocabulary.py', '01-materials/vocabulary-scope/sources.json',
                      '01-materials/vocabulary-scope/sources/anime.csv.gz',
                      '01-materials/vocabulary-scope/sources/manga.csv.gz',
                      '04-evaluation/round-05/before/02-course-design/inventory.json'])
        for relative in paths:
            dest = self.directory / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, dest)

    def test_replay_matches_every_historical_sample(self):
        result = self.audit()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = workspace.read(ROUND / 'lexical-results.json')
        actual = workspace.read(self.directory / 'result.json')
        for key in ['sizes', 'samples', 'works', 'genres', 'lexical_proxy_50_50']:
            self.assertEqual(actual[key], expected[key], key)
        self.assertIsNone(actual['comprehension_percent'])
        self.assertFalse(actual['student_test_performed'])

    def test_changed_feature_counts_are_rejected(self):
        data = workspace.read(ROUND / 'coverage-features.json')
        data['samples'][0]['features'][0]['count'] += 1
        changed = self.directory / 'changed.json'
        changed.write_text(json.dumps(data), encoding='utf-8')
        result = self.audit(changed)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Frozen feature file changed', result.stderr)

    def test_changed_course_cannot_impersonate_frozen_run(self):
        self.copy_frozen_inputs()
        lesson = self.directory / '02-course-design/lessons/01.md'
        with lesson.open('a', encoding='utf-8') as f:
            f.write('\nChanged course\n')
        result = self.audit(learning=self.directory)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Frozen file changed', result.stderr)

    def test_unsupported_current_word_requires_originals(self):
        self.copy_frozen_inputs()
        inventory = self.directory / '02-course-design/inventory.json'
        data = workspace.read(inventory)
        data['words'].append({'form': 'NOT_IN_FROZEN_JAPANESE_VOCABULARY_12345'})
        inventory.write_text(json.dumps(data), encoding='utf-8')
        result = self.audit(learning=self.directory, extra=['--current'])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Form outside feature vocabulary', result.stderr)

    def test_bad_download_does_not_create_or_overwrite(self):
        target = self.directory / 'download.bin'
        expected = hashlib.sha256(b'expected').hexdigest()
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            workspace.save(target, b'wrong', expected)
        self.assertFalse(target.exists())
        target.write_bytes(b'existing-other-version')
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            workspace.save(target, b'expected', expected)
        self.assertEqual(target.read_bytes(), b'existing-other-version')

if __name__ == '__main__':
    unittest.main(verbosity=2)
