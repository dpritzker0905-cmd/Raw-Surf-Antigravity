"""F-09 (audit 2026-10-18), part B: parental controls and comment locks are enforced on the server.

A guardian toggles can_comment / can_stream / view_only in the Grom's `parental_controls`, and the screen says
"Controls updated" - but no route read them (and `comments_disabled` on a post was ignored by comment create).
Real JWTs through the real routers over an ephemeral SQLite file; nothing leaves the process.

Cast (all Groms are linked and approved, so a refusal here is the guardian's switch and nothing else):
  grom_off     can_comment False, can_stream False        grom_on      every switch on
  grom_view    view_only True (other switches on)         grom_default parental_controls NULL
  grom_nochan  can_message_grom_channel False             adult        a surfer with stray Grom-style switches
  peer         a linked Grom to message                   owner        a surfer with an open and a closed post
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from core.security import create_access_token
from database import Base, get_db
from models import Comment, Conversation, Post, Profile, RoleEnum
from routes.grom_hq import router as grom_hq_router
from routes.live import router as live_router
from routes.live import livekit as livekit_routes
from routes.messages import conversations as messages_conversations
from routes.messages import router as messages_router
from routes.posts import router as posts_router
from services.parental_controls import refusal_for

ALL_ON = {'can_post': True, 'can_stream': True, 'can_message': True, 'can_message_grom_channel': True,
          'can_comment': True, 'view_only': False}
GROMS = {
    'grom_off': {**ALL_ON, 'can_comment': False, 'can_stream': False},
    'grom_on': dict(ALL_ON),
    'grom_view': {**ALL_ON, 'view_only': True},
    'grom_default': None,
    'grom_nochan': {**ALL_ON, 'can_message_grom_channel': False},
    'peer': dict(ALL_ON),
}
VIEW_ONLY = 'view-only'


def auth(user):
    return {'Authorization': f'Bearer {create_access_token({"sub": user})}'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / 'parental.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        def add(pid, role, **extra):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0, **extra))

        add('owner', RoleEnum.SURFER)
        add('parent', RoleEnum.GROM_PARENT)
        # an adult carrying Grom-style switches: they must mean nothing for a non-Grom
        add('adult', RoleEnum.SURFER, parental_controls={'can_comment': False, 'can_stream': False, 'view_only': True})
        for pid, controls in GROMS.items():
            add(pid, RoleEnum.GROM, parent_id='parent', parent_link_approved=True, parental_controls=controls)
        db.flush()
        db.add(Post(id='post-open', author_id='owner', media_url='https://example.invalid/a.jpg'))
        db.add(Post(id='post-closed', author_id='owner', media_url='https://example.invalid/b.jpg', comments_disabled=True))
        db.add(Comment(id='c-owner', post_id='post-closed', author_id='owner', content='the owner speaks'))
        # threads that already exist (the side door: voice / media into an old conversation)
        db.add(Conversation(id='conv-view', participant_one_id='grom_view', participant_two_id='peer'))
        db.add(Conversation(id='conv-nochan', participant_one_id='grom_nochan', participant_two_id='peer'))
        db.commit()
    sync_engine.dispose()

    engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            yield session

    monkeypatch.setattr(messages_conversations, 'onesignal_service', None)  # no push leaves the process
    monkeypatch.setattr(livekit_routes, '_is_configured', lambda: True)   # reach the gate, not the 503
    app = FastAPI()
    for router in (posts_router, messages_router, live_router, grom_hq_router):
        app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


def comment(client, user, post='post-open', **body):
    return client.post(f'/api/posts/{post}/comments', headers=auth(user), json={'content': 'hello', **body})


# ------------------------------------------------------------------------------------------ comments

@pytest.mark.parametrize('user', ['grom_off', 'grom_view'])
def test_a_grom_without_comment_permission_gets_403(client, user):
    r = comment(client, user)
    assert r.status_code == 403, r.text


def test_the_grom_with_comments_on_succeeds(client):
    assert comment(client, 'grom_on').status_code == 200


def test_a_grom_with_no_stored_controls_keeps_the_screens_default_comment_on(client):
    assert comment(client, 'grom_default').status_code == 200


def test_switches_on_a_non_grom_mean_nothing(client):
    assert comment(client, 'adult').status_code == 200
    assert client.post('/api/posts/post-open/like', headers=auth('adult')).status_code == 200


def test_view_only_message_names_the_reason(client):
    assert VIEW_ONLY in comment(client, 'grom_view').json()['detail']


# ------------------------------------------------------------------------------------ comments_disabled

def test_a_closed_post_refuses_everyone_else(client):
    assert comment(client, 'adult', post='post-closed').status_code == 403
    assert comment(client, 'grom_on', post='post-closed').status_code == 403
    reply = comment(client, 'adult', post='post-closed', parent_id='c-owner')
    assert reply.status_code == 403, reply.text


def test_the_owner_may_still_comment_on_their_own_closed_post(client):
    assert comment(client, 'owner', post='post-closed').status_code == 200


def test_an_open_post_is_unchanged(client):
    assert comment(client, 'adult', post='post-open').status_code == 200


# ------------------------------------------------------------------------------------------ view_only writes

def test_view_only_blocks_likes_and_reactions_and_not_other_groms(client):
    assert client.post('/api/posts/post-open/like', headers=auth('grom_view')).status_code == 403
    assert client.post('/api/posts/post-open/reactions', headers=auth('grom_view'),
                       json={'emoji': '\U0001F919'}).status_code == 403
    assert client.post('/api/posts/post-open/like', headers=auth('grom_on')).status_code == 200


def test_view_only_blocks_creating_a_post(client):
    r = client.post('/api/posts', params={'author_id': 'grom_view'}, headers=auth('grom_view'),
                    json={'media_url': 'https://example.invalid/x.jpg'})
    assert r.status_code == 403, r.text
    assert VIEW_ONLY in r.json()['detail']


def test_view_only_blocks_messages_and_a_switched_on_grom_can_message(client):
    refused = client.post('/api/messages/send', params={'sender_id': 'grom_view'}, headers=auth('grom_view'),
                          json={'recipient_id': 'peer', 'content': 'hi'})
    assert refused.status_code == 403, refused.text
    assert VIEW_ONLY in refused.json()['detail']
    ok = client.post('/api/messages/send', params={'sender_id': 'grom_on'}, headers=auth('grom_on'),
                     json={'recipient_id': 'peer', 'content': 'hi'})
    assert ok.status_code == 200, ok.text


def test_voice_note_and_media_follow_the_guardians_message_switches(client):
    """Voice notes and media never went through send_message, so a Grom could talk past every switch."""
    for user, conv in (('grom_view', 'conv-view'), ('grom_nochan', 'conv-nochan')):
        voice = client.post('/api/messages/voice-note', headers=auth(user),
                            data={'duration': '3', 'conversation_id': conv, 'sender_id': user},
                            files={'file': ('v.webm', b'x', 'audio/webm')})
        assert voice.status_code == 403, (user, voice.text)
        media = client.post('/api/messages/media', headers=auth(user),
                            data={'sender_id': user, 'conversation_id': conv},
                            files={'file': ('p.png', b'x', 'image/png')})
        assert media.status_code == 403, (user, media.text)
        new_chat = client.post('/api/messages/media', headers=auth(user),
                               data={'sender_id': user, 'recipient_id': 'peer'},
                               files={'file': ('p.png', b'x', 'image/png')})
        assert new_chat.status_code == 403, (user, new_chat.text)


# ------------------------------------------------------------------------------------------ going live

@pytest.mark.parametrize('user', ['grom_off', 'grom_view', 'grom_default'])
def test_going_live_needs_the_guardians_can_stream(client, user):
    """grom_default has no stored can_stream: the screen's default is off, so the server refuses."""
    start = client.post('/api/livekit/start-stream', headers=auth(user), json={'broadcaster_id': user})
    assert start.status_code == 403, start.text
    social = client.post('/api/livekit/start-social-live', headers=auth(user), json={'broadcaster_id': user})
    assert social.status_code == 403, social.text
    mux = client.post('/api/social-live/start', headers=auth(user), json={'broadcaster_id': user})
    assert mux.status_code == 403, mux.text


@pytest.mark.parametrize('user', ['grom_off', 'grom_view'])
def test_live_chat_is_commenting(client, user):
    r = client.post('/api/social-live/some-stream/comments', headers=auth(user),
                    json={'user_id': user, 'user_name': user, 'text': 'hi'})
    assert r.status_code == 403, r.text


def test_the_gate_lets_a_permitted_grom_and_every_adult_through():
    """The allowed side, without calling LiveKit/Mux: the pure decision."""
    # a confirmed link (guardian level L1+) so the switches, not the L0 lock, decide; an L0 child is tested below
    grom = {name: type('P', (), {'role': RoleEnum.GROM, 'parental_controls': controls, 'birthdate': None,
                                 'parent_id': 'parent', 'parent_link_approved': True})()
            for name, controls in GROMS.items()}
    assert refusal_for(grom['grom_on'], 'stream') is None
    assert refusal_for(grom['grom_on'], 'comment') is None
    assert refusal_for(grom['grom_default'], 'comment') is None        # default on
    assert refusal_for(grom['grom_default'], 'stream') is not None     # default off
    assert refusal_for(grom['grom_off'], 'comment') is not None
    assert refusal_for(grom['grom_view'], 'react') is not None
    adult = type('P', (), {'role': RoleEnum.SURFER, 'parental_controls': {'view_only': True, 'can_stream': False}})()
    for action in ('comment', 'stream', 'post', 'react', 'message'):
        assert refusal_for(adult, action) is None
    assert refusal_for(None, 'comment') is None


# ------------------------------------------------------------------------- the guardian screen is honest

def update_controls(client, grom, body):
    return client.post(f'/api/grom-hq/update-parental-controls/{grom}', params={'parent_id': 'parent'},
                       headers=auth('parent'), json=body)


def test_the_grom_zone_chat_toggle_is_saved_and_enforced(client):
    ok = client.post('/api/messages/send', params={'sender_id': 'grom_on'}, headers=auth('grom_on'),
                     json={'recipient_id': 'peer', 'content': 'before'})
    assert ok.status_code == 200, ok.text
    saved = update_controls(client, 'grom_on', {'can_message_grom_channel': False})
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body['parental_controls']['can_message_grom_channel'] is False
    assert 'can_message_grom_channel' in body['saved_keys']
    assert body['ignored_keys'] == []
    refused = client.post('/api/messages/send', params={'sender_id': 'grom_on'}, headers=auth('grom_on'),
                          json={'recipient_id': 'peer', 'content': 'after'})
    assert refused.status_code == 403, refused.text
    assert 'Grom Zone' in refused.json()['detail']


def test_keys_the_route_does_not_own_are_named_not_silently_dropped(client):
    r = update_controls(client, 'grom_on', {'can_comment': True, 'spending_limit': 5, 'bogus_key': 1})
    assert r.status_code == 200, r.text
    assert r.json()['ignored_keys'] == ['bogus_key', 'spending_limit']
    assert 'bogus_key' not in r.json()['parental_controls']


def test_a_guardian_toggling_can_comment_changes_what_the_server_does(client):
    assert comment(client, 'grom_on').status_code == 200
    assert update_controls(client, 'grom_on', {'can_comment': False}).status_code == 200
    assert comment(client, 'grom_on').status_code == 403
    assert update_controls(client, 'grom_on', {'can_comment': True}).status_code == 200
    assert comment(client, 'grom_on').status_code == 200
