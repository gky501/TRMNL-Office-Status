from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('scheduler', Path(__file__).parents[1] / 'scripts/scheduler.py')
scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scheduler)


def dt(value):
    return scheduler.instant(value)


def weekly(**overrides):
    return {'id': 'morning', 'kind': 'weekly', 'enabled': True, 'timezone': 'America/Chicago', 'time': '08:00', 'days': [0, 1, 2, 3, 4], 'updated_at': '2026-01-01T00:00:00Z', 'status': {'message': 'IN THE OFFICE'}, **overrides}


class SchedulerTests(unittest.TestCase):
    def test_weekly_central_daylight_time_and_duplicate(self):
        entry = weekly()
        self.assertEqual(scheduler.occurrence(entry, dt('2026-10-21T13:03:00Z')), dt('2026-10-21T13:00:00Z'))
        entry['last_run'] = '2026-10-21T13:00:00Z'
        self.assertIsNone(scheduler.occurrence(entry, dt('2026-10-21T13:05:00Z')))

    def test_weekly_follows_winter_time(self):
        self.assertEqual(scheduler.occurrence(weekly(), dt('2026-11-04T14:03:00Z')), dt('2026-11-04T14:00:00Z'))

    def test_skip_spring_gap_and_run_fall_fold_once(self):
        spring = weekly(days=[6], time='02:30')
        self.assertIsNone(scheduler.occurrence(spring, dt('2026-03-08T09:00:00Z')))
        fall = weekly(days=[6], time='01:30')
        self.assertEqual(scheduler.occurrence(fall, dt('2026-11-01T07:45:00Z')), dt('2026-11-01T06:30:00Z'))
        fall['last_run'] = '2026-11-01T06:30:00Z'
        self.assertIsNone(scheduler.occurrence(fall, dt('2026-11-01T07:45:00Z')))

    def test_once_future_paused_and_expired(self):
        once = weekly(kind='once', at='2026-10-21T14:00:00Z')
        self.assertIsNone(scheduler.occurrence(once, dt('2026-10-21T13:59:00Z')))
        self.assertEqual(scheduler.occurrence(once, dt('2026-10-21T14:04:00Z')), dt(once['at']))
        self.assertIsNone(scheduler.occurrence(once, dt('2026-10-22T14:01:00Z')))
        once['enabled'] = False
        self.assertIsNone(scheduler.occurrence(once, dt('2026-10-21T14:04:00Z')))

    def test_new_weekly_schedule_does_not_replay_earlier_today(self):
        entry = weekly(updated_at='2026-10-21T14:00:00Z')
        self.assertIsNone(scheduler.occurrence(entry, dt('2026-10-21T14:05:00Z')))

    def test_latest_due_wins_with_invalid_entry_ignored(self):
        entries = [weekly(kind='once', at='2026-10-21T13:00:00Z'), weekly(id='later', kind='once', at='2026-10-21T13:05:00Z'), {'bad': 'entry'}]
        due = scheduler.due_entries(entries, dt('2026-10-21T13:06:00Z'))
        self.assertEqual([item[1]['id'] for item in due], ['morning', 'later'])

    def test_prepare_writes_snapshot_and_does_not_mark_sent(self):
        doc = {'entries': [weekly(kind='once', at='2026-10-21T13:00:00Z')]}
        with tempfile.TemporaryDirectory() as directory:
            old = os.getcwd()
            try:
                os.chdir(directory)
                with patch.dict(os.environ, {'GITHUB_OUTPUT': 'outputs.txt'}), patch.object(scheduler, 'fetch_document', return_value=(doc, 'sha')):
                    scheduler.prepare('api', 'token', dt('2026-10-21T13:05:00Z'))
                self.assertEqual(Path('outputs.txt').read_text(), 'has_due=true\n')
                self.assertEqual(json.loads(Path('custom-status-input.json').read_text()), {'message': 'IN THE OFFICE'})
                self.assertNotIn('last_run', doc['entries'][0])
                self.assertEqual(json.loads(scheduler.STATE.read_text())['due'][0]['outcome'], 'sent')
            finally:
                os.chdir(old)

    def test_completion_retries_conflict_and_preserves_new_schedule(self):
        entry = weekly()
        changes = {'due': [{'id': 'morning', 'updated_at': entry['updated_at'], 'occurrence': '2026-10-21T13:00:00+00:00', 'outcome': 'sent'}]}
        doc1 = {'entries': [dict(entry)]}
        doc2 = {'entries': [dict(entry), weekly(id='new-entry')]}
        conflict = urllib.error.HTTPError('https://example.test', 409, 'conflict', {}, None)
        with patch.object(Path, 'read_text', return_value=json.dumps(changes)), patch.object(scheduler, 'fetch_document', side_effect=[(doc1, 'old-sha'), (doc2, 'new-sha')]), patch.object(scheduler.publisher, 'request_json', side_effect=[conflict, {}]) as send:
            scheduler.complete('api', 'token')
        self.assertEqual(send.call_count, 2)
        self.assertEqual(send.call_args.kwargs['method'], 'PUT')
        payload = send.call_args.args[1]
        self.assertEqual(payload['sha'], 'new-sha')
        self.assertEqual(len(doc2['entries']), 2)
        self.assertEqual(doc2['entries'][0]['last_result'], 'sent')
        self.assertNotIn('last_run', doc2['entries'][1])

    def test_completion_does_not_overwrite_edited_or_deleted_entries(self):
        change = {'due': [{'id': 'morning', 'updated_at': 'old', 'occurrence': '2026-10-21T13:00:00Z', 'outcome': 'sent'}]}
        with patch.object(Path, 'read_text', return_value=json.dumps(change)), patch.object(scheduler, 'fetch_document', return_value=({'entries': [weekly(updated_at='2026-10-21T13:30:00Z')]}, 'sha')), patch.object(scheduler.publisher, 'request_json') as send:
            scheduler.complete('api', 'token')
        send.assert_not_called()

    def test_no_schedules_never_attempts_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output.txt'
            with patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}), patch.object(scheduler, 'fetch_document', return_value=({'entries': []}, None)), patch.object(scheduler.publisher, 'request_json') as send:
                scheduler.prepare('api', 'token', dt('2026-10-21T13:05:00Z'))
            self.assertEqual(output.read_text(), 'has_due=false\n')
            send.assert_not_called()

    def test_recheck_skips_paused_deleted_or_newer_schedule(self):
        entry = weekly(kind='once', at='2026-10-21T13:00:00Z')
        planned = {'due': [{'id': entry['id'], 'updated_at': entry['updated_at'], 'occurrence': '2026-10-21T13:00:00Z', 'outcome': 'sent'}]}
        for entries, expected in [([entry], 'true'), ([], 'false'), ([{**entry, 'enabled': False}], 'false'), ([entry, weekly(id='later', kind='once', at='2026-10-21T13:05:00Z')], 'false')]:
            with self.subTest(expected=expected, entries=entries), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'output.txt'
                with patch.object(scheduler.STATE.__class__, 'read_text', return_value=json.dumps(planned)), patch.dict(os.environ, {'GITHUB_OUTPUT': str(output)}), patch.object(scheduler, 'fetch_document', return_value=({'entries': entries}, 'sha')):
                    scheduler.revalidate('api', 'token', dt('2026-10-21T13:06:00Z'))
                self.assertEqual(output.read_text(), 'has_due=' + expected + '\n')


if __name__ == '__main__':
    unittest.main()
