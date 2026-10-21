"""Find due status snapshots and record completed sends without replacing edits."""
import argparse
import base64
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import urllib.error
from zoneinfo import ZoneInfo

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-status.py'))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
BRANCH = 'trmnl-schedules'
STATE = Path('.schedule-state.json')
UTC = timezone.utc


def instant(value):
    value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.tzinfo is None:
        raise ValueError('An offset is required.')
    return value.astimezone(UTC)


def occurrence(entry, now):
    if not entry.get('enabled', True):
        return None
    start = instant(entry['updated_at'])
    last = instant(entry['last_run']) if entry.get('last_run') else datetime.min.replace(tzinfo=UTC)
    cutoff = now - timedelta(hours=24)
    if entry['kind'] == 'once':
        due = instant(entry['at'])
    elif entry['kind'] == 'weekly':
        zone = ZoneInfo(entry['timezone'])
        local = now.astimezone(zone)
        hour, minute = map(int, entry['time'].split(':'))
        candidates = []
        for days_ago in range(8):
            day = local.date() - timedelta(days=days_ago)
            if day.weekday() not in entry['days']:
                continue
            wall = datetime(day.year, day.month, day.day, hour, minute, tzinfo=zone, fold=0)
            candidate = wall.astimezone(UTC)
            # Skip nonexistent spring-forward times; fall-back runs only the first occurrence.
            if candidate.astimezone(zone).replace(tzinfo=None) != wall.replace(tzinfo=None):
                continue
            if candidate <= now:
                candidates.append(candidate)
        if not candidates:
            return None
        due = max(candidates)
    else:
        raise ValueError('Unknown schedule type.')
    return due if max(start, cutoff) <= due <= now and due > last else None


def due_entries(entries, now):
    due = []
    for entry in entries:
        try:
            when = occurrence(entry, now)
            if when is not None:
                status = entry['status']
                if not isinstance(status, dict) or not str(status.get('message', '')).strip():
                    raise ValueError('A headline is required.')
                due.append((when, entry))
        except (ValueError, KeyError, TypeError, OverflowError):
            print('Ignoring an invalid schedule entry.')
    # Newest status wins after delays. ID makes simultaneous changes deterministic.
    return sorted(due, key=lambda pair: (pair[0], str(pair[1]['id'])))


def fetch_document(api, token):
    try:
        data = publisher.request_json(api + '/contents/schedules.json?ref=' + BRANCH, token=token)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {'version': 1, 'entries': []}, None
        raise
    doc = json.loads(base64.b64decode(data['content']))
    if not isinstance(doc.get('entries'), list):
        raise ValueError('Invalid schedule document.')
    return doc, data['sha']


def prepare(api, token, now):
    doc, _ = fetch_document(api, token)
    due = due_entries(doc['entries'], now)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('has_due=' + ('true' if due else 'false') + '\n')
    if not due:
        print('No status change is due.')
        return
    winner = due[-1][1]
    Path('custom-status-input.json').write_text(json.dumps(winner['status']))
    STATE.write_text(json.dumps({'due': [{'id': e['id'], 'updated_at': e['updated_at'], 'occurrence': when.isoformat(), 'outcome': 'sent' if e['id'] == winner['id'] else 'superseded'} for when, e in due]}))
    print('A scheduled status is ready to render.')


def revalidate(api, token, now):
    planned = next(change for change in json.loads(STATE.read_text())['due'] if change['outcome'] == 'sent')
    doc, _ = fetch_document(api, token)
    due = due_entries(doc['entries'], now)
    valid = bool(due and due[-1][1]['id'] == planned['id']
                 and due[-1][1]['updated_at'] == planned['updated_at']
                 and due[-1][0] == instant(planned['occurrence']))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write('has_due=' + ('true' if valid else 'false') + '\n')
    if not valid:
        print('The planned schedule changed or a newer sign became due; leaving it for the next check.')


def complete(api, token):
    changes = json.loads(STATE.read_text())['due']
    for attempt in range(3):
        doc, sha = fetch_document(api, token)
        changed = False
        for entry in doc['entries']:
            for change in changes:
                if entry['id'] == change['id'] and entry.get('updated_at') == change['updated_at']:
                    previous = instant(entry['last_run']) if entry.get('last_run') else datetime.min.replace(tzinfo=UTC)
                    if instant(change['occurrence']) > previous:
                        entry['last_run'] = change['occurrence']
                        entry['last_result'] = change['outcome']
                        changed = True
        if not changed:
            return
        payload = {'message': 'Record scheduled TRMNL status result', 'branch': BRANCH, 'sha': sha, 'content': base64.b64encode(json.dumps(doc, indent=2).encode()).decode()}
        try:
            publisher.request_json(api + '/contents/schedules.json', payload, token, method='PUT')
            print('Schedule result recorded.')
            return
        except urllib.error.HTTPError as error:
            if error.code != 409 or attempt == 2:
                raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'revalidate', 'complete'])
    args = parser.parse_args()
    api = 'https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY']
    try:
        if args.command == 'prepare':
            prepare(api, os.environ['GH_TOKEN'], datetime.now(UTC))
        elif args.command == 'revalidate':
            revalidate(api, os.environ['GH_TOKEN'], datetime.now(UTC))
        else:
            complete(api, os.environ['GH_TOKEN'])
    except urllib.error.HTTPError as error:
        raise SystemExit(f'Schedule storage request failed with HTTP {error.code}.')
    except urllib.error.URLError:
        raise SystemExit('Could not connect to schedule storage.')
