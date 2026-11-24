"""Offline checks through the receiver's WSGI entrypoint and Stripe's real signature verifier."""
import hashlib
import hmac
import io
import json
import os
import secrets
import time
import unittest
from unittest.mock import Mock, patch

from scripts import stripe_test_ingress as ingress


class ReceiverTest(unittest.TestCase):
    def setUp(self):
        self.secret = 'whsec_' + secrets.token_hex(32)
        self.tag = secrets.token_hex(16)
        sha = 'a' * 40
        self.env = patch.dict(os.environ, {
            'RENDER_EXTERNAL_HOSTNAME': ingress.HOST, 'RENDER_SERVICE_ID': 'srv-local',
            'INGRESS_EXPECTED_SERVICE': 'srv-local', 'RENDER_GIT_COMMIT': sha,
            'INGRESS_EXPECTED_COMMIT': sha, 'INGRESS_SIGNING_SECRET': self.secret,
            'INGRESS_DB_PASSWORD': secrets.token_hex(24), 'INGRESS_CANARY_TAG': self.tag,
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.event = {'id': 'evt_local', 'object': 'event', 'type': 'test_helpers.test_clock.created',
                      'livemode': False, 'data': {'object': {
                          'object': 'test_helpers.test_clock', 'id': 'clock_local', 'livemode': False,
                          'status': 'ready', 'name': self.tag}}}
        self.save = Mock()

    def post(self, offset=0, secret=None):
        body = json.dumps(self.event).encode()
        timestamp = str(int(time.time()) + offset)
        digest = hmac.new((secret or self.secret).encode(), timestamp.encode() + b'.' + body, hashlib.sha256).hexdigest()
        env = {'PATH_INFO': ingress.PATH, 'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': 'application/json',
               'CONTENT_LENGTH': str(len(body)), 'wsgi.input': io.BytesIO(body),
               'HTTP_STRIPE_SIGNATURE': f't={timestamp},v1={digest}'}
        response = Mock()
        with patch.object(ingress, 'persist', self.save):
            ingress.application(env, response)
        return int(response.call_args.args[0].split()[0])

    def test_correlated_canary(self):
        self.assertEqual(self.post(), 200)
        self.save.assert_called_once_with('evt_local', 'test_helpers.test_clock.created', 'clock_local')

    def test_unrelated_clock(self):
        self.event['data']['object']['name'] = 'other'
        self.assertEqual(self.post(), 204)
        self.save.assert_not_called()

    def test_invalid_signature_and_timestamp(self):
        for status in (self.post(secret=secrets.token_hex(16)), self.post(-500), self.post(500)):
            self.assertEqual(status, 400)
        self.save.assert_not_called()

    def test_reject_other_account_and_live(self):
        for target, key, value in [(self.event, 'account', 'other'), (self.event, 'context', 'other'),
                                   (self.event, 'livemode', True), (self.event['data']['object'], 'livemode', True)]:
            with patch.dict(target, {key: value}):
                self.assertEqual(self.post(), 400)
        self.save.assert_not_called()

    def test_checkout_filters(self):
        obj = self.event['data']['object']
        obj.update(object='checkout.session', id='cs_test_local', metadata={'type': 'live_session_join'})
        for kind in ingress.CHECKOUT:
            self.event['type'] = kind
            self.assertEqual(self.post(), 200)
            self.save.assert_called_with('evt_local', kind, 'cs_test_local')
        obj['metadata'] = {}
        self.assertEqual(self.post(), 204)
        obj['id'] = 'cs_live_wrong'
        self.assertEqual(self.post(), 400)
        self.assertEqual(self.save.call_count, 2)

    def test_storage_failure_requires_retry(self):
        self.save.side_effect = ingress.psycopg2.OperationalError()
        self.assertEqual(self.post(), 503)

    def test_misbound_service_fails_closed(self):
        with patch.dict(os.environ, RENDER_SERVICE_ID='another'):
            self.assertEqual(self.post(), 503)
        self.save.assert_not_called()
