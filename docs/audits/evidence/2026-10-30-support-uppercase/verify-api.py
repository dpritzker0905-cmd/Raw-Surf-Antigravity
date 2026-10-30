"""Case-variant owner ticket API tests with disposable storage and existing fake delivery seam."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import types

import httpx
import sqlalchemy as sa

OUT = Path(__file__).resolve().parent
OWN_ROOT = OUT.parents[3]
parser = argparse.ArgumentParser()
parser.add_argument('--source-root', type=Path, default=OWN_ROOT)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
ROOT = args.source_root.resolve()
os.environ['RAW_SUPPORT_SOURCE_ROOT'] = str(ROOT)
os.environ['RAW_SUPPORT_FIXTURE_OUTPUT_DIR'] = str(args.output.resolve().parent / '.run' / args.output.stem)
helper_path = OUT.parent / '2026-10-29-support-delivery/verify-delivery.py'
helper = helper_path.read_text(encoding='utf-8')
anchor = 'ROOT = OUT.parents[3]'
assert helper.count(anchor) == 1
helper = helper.replace(anchor, 'ROOT = Path(os.environ["RAW_SUPPORT_SOURCE_ROOT"])')
f = types.ModuleType('uppercase_delivery_fixture')
f.__file__ = str(helper_path)
sys.modules[f.__name__] = f
# Only fixture root wiring changes; the selected production route source is compiled unchanged.
exec(compile(helper, str(helper_path), 'exec'), f.__dict__)
for relative in ['backend/models/admin_ops.py', 'backend/models/enums.py', 'backend/models/social.py',
                 'backend/models/surf_alerts.py', 'backend/models/email_outbox.py']:
    assert (ROOT / relative).read_bytes() == (OWN_ROOT / relative).read_bytes(), 'Shared declaration fixture drift: ' + relative
f.TICKET = 'abcdef01-2345-4789-abcd-ef0123456789'
f.FOREIGN = 'fedcba10-4321-4897-bcde-9876543210ab'
cases = []


@sa.event.listens_for(f.engine.sync_engine, 'connect')
def enforce_foreign_keys(connection, _record):
    cursor = connection.cursor()
    cursor.execute('PRAGMA foreign_keys=ON')
    cursor.close()


def check(name, passed, **details):
    cases.append({'name': name, 'passed': bool(passed), **details})


async def main():
    try:
        await f.seed()
        statements = []

        def observe(_connection, _cursor, statement, _params, _context, _many):
            statements.append(statement)

        sa.event.listen(f.engine.sync_engine, 'before_cursor_execute', observe)
        owner = {'X-Fixture-User': f.OWNER}
        other = {'X-Fixture-User': f.OTHER}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=f.app), base_url='http://fixture.invalid') as client:
            baseline = await f.snapshot()
            lower = await client.get('/support/tickets/' + f.TICKET, headers=owner)
            check('lowercase owner read remains valid', lower.status_code == 200)
            for variant in [f.TICKET.upper(), 'aBcDeF01-2345-4789-AbCd-eF0123456789']:
                response = await client.get('/support/tickets/' + variant, headers=owner)
                check('case variant reads identical public conversation ' + variant[:8], response.status_code == 200 and
                      response.json() == lower.json(), status=response.status_code)
            after_reads = await f.snapshot()
            check('case-variant GETs make no storage changes', after_reads == baseline)
            before = len(statements)
            response = await client.get('/support/tickets/' + f.TICKET.upper(), headers=other)
            check('wrong owner uppercase remains404 before message query', response.status_code == 404 and
                  not any('ticket_messages' in item.lower() for item in statements[before:]), status=response.status_code)
            response = await client.get('/support/tickets/' + f.TICKET.upper())
            check('anonymous uppercase read remains401', response.status_code == 401)
            for value in ['not-a-uuid', f.TICKET.replace('-', ''), '{' + f.TICKET + '}', 'urn:uuid:' + f.TICKET,
                          'abcdef01-2345-4789-abcd-000000000000']:
                response = await client.get('/support/tickets/' + value, headers=owner)
                check('unsupported or missing ID stays404 ' + value[:12], response.status_code == 404)
            request = {'message': 'Synthetic uppercase reply', 'client_message_id': 'abcd1234-1234-4234-8234-123456789abc'}
            before_reply = await f.snapshot()
            first = await client.post('/support/tickets/' + f.TICKET.upper() + '/messages', headers=owner, json=request)
            check('uppercase reply succeeds with enforced foreign keys', first.status_code == 200, status=first.status_code)
            retry = await client.post('/support/tickets/' + f.TICKET + '/messages', headers=owner, json=request)
            check('lowercase retry finds original uppercase request', first.status_code == 200 and retry.status_code == 200 and
                  retry.json()['duplicate'] and retry.json()['message_id'] == first.json()['message_id'])
            retry_upper = await client.post('/support/tickets/' + f.TICKET.upper() + '/messages', headers=owner, json=request)
            check('uppercase retry also retains one message', retry_upper.status_code == 200 and retry_upper.json()['duplicate'])
            changed = await client.post('/support/tickets/' + f.TICKET.upper() + '/messages', headers=owner,
                                        json={**request, 'message': 'Changed synthetic intent'})
            check('case variant does not bypass same-key content conflict', changed.status_code == 409)
            denied = await client.post('/support/tickets/' + f.TICKET.upper() + '/messages', headers=other, json=request)
            check('wrong owner uppercase reply remains404', denied.status_code == 404)
            snapshot = await f.snapshot()
            added = [row for row in snapshot['ticket_messages'] if row['id'] not in {r['id'] for r in before_reply['ticket_messages']}]
            check('one canonical FK/message across variants', len(added) == 1 and added[0]['ticket_id'] == f.TICKET and
                  added[0]['sender_id'] == f.OWNER and added[0]['is_internal_note'] is False)
            public = await client.get('/support/tickets/' + f.TICKET.upper(), headers=owner)
            check('reply visible in uppercase public conversation with internal note excluded', public.status_code == 200 and
                  len(public.json()['messages']) == 2 and all('INTERNAL' not in m['message'] for m in public.json()['messages']))
            old_ticket = next(r for r in before_reply['support_tickets'] if r['id'] == f.TICKET)
            new_ticket = next(r for r in snapshot['support_tickets'] if r['id'] == f.TICKET)
            check('canonical ticket updated_at advances on uppercase reply', new_ticket['updated_at'] > old_ticket['updated_at'])
            check('reply preserves original lifecycle and SLA origin', all(new_ticket[key] == old_ticket[key] for key in
                  ['created_at', 'status', 'priority', 'resolved_at', 'first_response_at', 'sla_due_at']))
            check('owner reply creates no owner notification or email', snapshot['notifications'] == [] and snapshot['email_outbox'] == [] and
                  f.sender.messages == [])
        result = {'passed': sum(row['passed'] for row in cases), 'total': len(cases), 'cases': cases,
                  'database': 'disposable SQLite, foreign_keys ON', 'authentication': 'fictional header identity, actual owner SQL',
                  'external': 0, 'sender': 'in-memory fake only', 'source': {relative: {
                      'sha256': hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()} for relative in
                      ['backend/routes/admin/support.py', 'backend/services/support_delivery.py']}}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps({'passed': result['passed'], 'total': result['total'], 'failed': [r['name'] for r in cases if not r['passed']]}))
        return 0 if result['passed'] == result['total'] else 1
    finally:
        await f.engine.dispose()


sys.exit(asyncio.run(main()))
