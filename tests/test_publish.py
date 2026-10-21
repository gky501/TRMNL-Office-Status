import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('publisher', Path(__file__).parents[1] / 'scripts/publish-status.py')
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'GITHUB_REPOSITORY': 'example/status', 'GH_TOKEN': 'test-token', 'TRMNL_WEBHOOK_URL': 'https://example.test/webhook', 'GITHUB_SHA': 'immutable-sha', 'MODE': 'image', 'FILENAME': 'IN-OFFICE.png'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_library_uses_immutable_url(self):
        with patch.object(publisher, 'request_json', return_value={}) as req:
            publisher.main()
            self.assertEqual(req.call_args.args[1], {'merge_variables': {'image_url': 'https://raw.githubusercontent.com/example/status/immutable-sha/images/IN-OFFICE.png'}})

    def test_reject_path_traversal(self):
        os.environ['FILENAME'] = '../README.md'
        with self.assertRaises(ValueError):
            publisher.main()

    def test_missing_webhook_fails_before_publishing(self):
        os.environ['TRMNL_WEBHOOK_URL'] = ''
        with patch.object(publisher, 'request_json') as req, self.assertRaises(ValueError):
            publisher.main()
        req.assert_not_called()

    def test_custom_image_updates_dedicated_branch(self):
        os.environ['MODE'] = 'custom'
        with tempfile.TemporaryDirectory() as directory:
            old = os.getcwd()
            try:
                os.chdir(directory)
                Path('custom-status.png').write_bytes(b'png')
                responses = [{}, {'sha': 'previous-image'}, {'commit': {'sha': 'new-commit'}}, {}]
                with patch.object(publisher, 'request_json', side_effect=responses) as req:
                    publisher.main()
                    payload = req.call_args_list[2].args[1]
                    self.assertEqual(payload['branch'], 'trmnl-rendered')
                    self.assertEqual(payload['sha'], 'previous-image')
                    self.assertIn('/new-commit/custom-status.png', req.call_args.args[1]['merge_variables']['image_url'])
            finally:
                os.chdir(old)

    def test_first_custom_send_creates_branch(self):
        os.environ['MODE'] = 'custom'
        missing = urllib.error.HTTPError('https://example.test', 404, 'not found', {}, None)
        with patch.object(Path, 'read_bytes', return_value=b'png'):
            responses = [missing, {'object': {'sha': 'main-sha'}}, {}, missing, {'commit': {'sha': 'first'}}, {}]
            with patch.object(publisher, 'request_json', side_effect=responses) as req:
                publisher.main()
                self.assertEqual(req.call_args_list[2].args[1], {'ref': 'refs/heads/trmnl-rendered', 'sha': 'main-sha'})
                self.assertNotIn('sha', req.call_args_list[4].args[1])


    def test_upload_uses_put_and_webhook_uses_post(self):
        """Exercise real HTTP request construction; mock only the network."""
        os.environ['MODE'] = 'custom'
        captured = []

        def respond(request, timeout):
            captured.append(request)
            if request.full_url.endswith('/git/ref/heads/trmnl-rendered'):
                return io.BytesIO(b'{}')
            if '?ref=trmnl-rendered' in request.full_url:
                raise urllib.error.HTTPError(request.full_url, 404, 'not found', {}, None)
            if request.full_url.endswith('/contents/custom-status.png'):
                self.assertEqual(request.get_method(), 'PUT')
                body = json.loads(request.data)
                self.assertEqual(body['branch'], 'trmnl-rendered')
                self.assertEqual(body['content'], 'cG5n')
                return io.BytesIO(b'{"commit":{"sha":"uploaded-commit"}}')
            self.assertEqual(request.full_url, 'https://example.test/webhook')
            self.assertEqual(request.get_method(), 'POST')
            self.assertIn('/uploaded-commit/custom-status.png', json.loads(request.data)['merge_variables']['image_url'])
            self.assertIsNone(request.get_header('Authorization'))
            return io.BytesIO(b'{}')

        with patch.object(Path, 'read_bytes', return_value=b'png'):
            with patch.object(publisher.urllib.request, 'urlopen', side_effect=respond):
                publisher.main()
        self.assertEqual([request.get_method() for request in captured], ['GET', 'GET', 'PUT', 'POST'])

    def test_existing_image_upload_uses_put_with_previous_sha(self):
        os.environ['MODE'] = 'custom'

        def respond(request, timeout):
            if request.full_url.endswith('/git/ref/heads/trmnl-rendered'):
                return io.BytesIO(b'{}')
            if '?ref=trmnl-rendered' in request.full_url:
                return io.BytesIO(b'{"sha":"previous-image"}')
            if request.full_url.endswith('/contents/custom-status.png'):
                self.assertEqual(request.get_method(), 'PUT')
                self.assertEqual(json.loads(request.data)['sha'], 'previous-image')
                return io.BytesIO(b'{"commit":{"sha":"updated-commit"}}')
            self.assertEqual(request.get_method(), 'POST')
            return io.BytesIO(b'{}')

        with patch.object(Path, 'read_bytes', return_value=b'png'):
            with patch.object(publisher.urllib.request, 'urlopen', side_effect=respond):
                publisher.main()


if __name__ == '__main__':
    unittest.main()
