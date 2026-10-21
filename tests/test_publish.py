import importlib.util
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


if __name__ == '__main__':
    unittest.main()
