"""Publish an image on a dedicated branch and send its immutable URL to TRMNL."""
import base64
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def request_json(url, payload=None, token=None):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'trmnl-office-status'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def main():
    repo = os.environ['GITHUB_REPOSITORY']
    token = os.environ['GH_TOKEN']
    webhook = os.environ.get('TRMNL_WEBHOOK_URL', '')
    if not webhook.startswith('https://'):
        raise ValueError('Configure the TRMNL_WEBHOOK_URL repository secret with an HTTPS webhook URL.')
    api = 'https://api.github.com/repos/' + repo
    if os.environ.get('MODE', 'image') == 'custom':
        branch = 'trmnl-rendered'
        try:
            request_json(api + '/git/ref/heads/' + branch, token=token)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            source = request_json(api + '/git/ref/heads/main', token=token)
            request_json(api + '/git/refs', {'ref': 'refs/heads/' + branch, 'sha': source['object']['sha']}, token)
        endpoint = api + '/contents/custom-status.png'
        sha = None
        try:
            sha = request_json(endpoint + '?ref=' + branch, token=token)['sha']
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        payload = {'message': 'Update custom TRMNL status', 'branch': branch, 'content': base64.b64encode(Path('custom-status.png').read_bytes()).decode()}
        if sha:
            payload['sha'] = sha
        result = request_json(endpoint, payload, token)
        image_url = f"https://raw.githubusercontent.com/{repo}/{result['commit']['sha']}/custom-status.png"
    else:
        filename = os.environ.get('FILENAME', '')
        if Path(filename).name != filename or not filename.endswith('.png') or not (Path('images') / filename).is_file():
            raise ValueError('Choose an existing status image.')
        image_url = f"https://raw.githubusercontent.com/{repo}/{os.environ['GITHUB_SHA']}/images/{filename}"
    request_json(webhook, {'merge_variables': {'image_url': image_url}})
    print('TRMNL accepted the webhook request. The sign will update on its next refresh.')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        # Do not print webhook addresses or response bodies: they can contain secrets.
        raise SystemExit(f'Remote request failed with HTTP {error.code}. Check repository permissions and the TRMNL webhook secret.')

    except urllib.error.URLError:
        raise SystemExit('Could not connect to GitHub or TRMNL. Please try the workflow again.')
