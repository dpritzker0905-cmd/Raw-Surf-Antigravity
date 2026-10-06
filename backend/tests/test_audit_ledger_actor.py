"""Exercise the real CLI writer against an isolated ledger, never the project ledger."""
import pytest

from scripts import action_ledger as ledger


ARGS = ['append', '--kind', 'finding', '--target', 'fixture', '--why', 'fixture',
        '--authorized-by', 'fixture', '--evidence', 'fixture', '--outcome', 'fixture',
        '--verified', 'fixture readback', '--rollback', 'delete fixture']


@pytest.mark.parametrize('environment', [None, 'claude', 'codex'])
def test_missing_actor_refuses_without_creating_ledger(monkeypatch, tmp_path, environment):
    path = tmp_path / 'actions.jsonl'
    monkeypatch.setattr(ledger, 'LEDGER', str(path))
    if environment is None:
        monkeypatch.delenv('LEDGER_ACTOR', raising=False)
    else:
        monkeypatch.setenv('LEDGER_ACTOR', environment)
    with pytest.raises(SystemExit) as refusal:
        ledger.main(ARGS)
    assert refusal.value.code == 2 and not path.exists()


@pytest.mark.parametrize('actor', ['codex', 'owner'])
def test_explicit_actor_survives_environment_and_hash_verification(monkeypatch, tmp_path, actor):
    path = tmp_path / 'actions.jsonl'
    monkeypatch.setattr(ledger, 'LEDGER', str(path))
    monkeypatch.setenv('LEDGER_ACTOR', 'claude')
    assert ledger.main(ARGS + ['--actor', actor]) == 0
    lines = ledger.read_lines(str(path))
    assert ledger.verify(lines) == []
    assert __import__('json').loads(lines[0])['actor'] == actor
