"""The cloud canary must reject ambiguous or shared targets before provider access."""
import importlib.util
from pathlib import Path
import secrets
import pytest

path = Path(__file__).resolve().parents[2] / 'audit/repair-2026-10-04/manifest_staging_canary.py'
spec = importlib.util.spec_from_file_location('manifest_staging_canary', path)
canary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(canary)


@pytest.mark.parametrize('invalid', ['reference', 'http', 'path', 'userinfo', 'port', 'missing-key', 'shared'])
def test_staging_target_refuses_ambiguous_or_shared_configuration(invalid):
    reference = 'a' * 20
    base = 'https://' + reference + '.supabase.co'
    environment = {'STAGING_SUPABASE_URL': base, 'STAGING_SUPABASE_SERVICE_ROLE_KEY': secrets.token_urlsafe(32)}
    if invalid == 'reference': reference = ''
    elif invalid == 'http': environment['STAGING_SUPABASE_URL'] = base.replace('https:', 'http:')
    elif invalid == 'path': environment['STAGING_SUPABASE_URL'] = base + '/rest/v1'
    elif invalid == 'userinfo': environment['STAGING_SUPABASE_URL'] = base.replace('https://', 'https://actor@')
    elif invalid == 'port': environment['STAGING_SUPABASE_URL'] = base + ':443'
    elif invalid == 'missing-key': environment.pop('STAGING_SUPABASE_SERVICE_ROLE_KEY')
    elif invalid == 'shared': environment['SUPABASE_URL'] = base
    with pytest.raises(ValueError): canary.staging_target(reference, environment)


def test_staging_target_accepts_only_explicit_matching_target():
    reference = 'a' * 20
    base = 'https://' + reference + '.supabase.co'
    key = secrets.token_urlsafe(32)
    assert canary.staging_target(reference, {'STAGING_SUPABASE_URL': base,
        'STAGING_SUPABASE_SERVICE_ROLE_KEY': key}) == (base, key)
