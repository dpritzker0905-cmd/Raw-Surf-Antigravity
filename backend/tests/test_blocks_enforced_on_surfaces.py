"""F-09 (audit 2026-10-18): a block is enforced on every surface that lets one account reach another.

`UserBlock` rows were written by /users/block but read by nothing, so a blocked user could still DM, comment on,
react to, follow, view and search the person who blocked them. Real JWTs through the real routers over an
ephemeral SQLite file; nothing leaves the process.

Cast: alice blocked bob; carol has no block with anybody. Actions are refused 403 in BOTH directions, views are
404 to the blocked viewer only (the blocker can still open the page to unblock), lists hide the pair both ways,
and carol (the control) gets exactly the behaviour she had before.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

from core.security import create_access_token
from database import Base, get_db
from models import Comment, Conversation, Message, Post, Profile, RoleEnum, UserBlock
from routes.messages import conversations as messages_conversations
from routes.messages import router as messages_router
from routes.posts import router as posts_router
from routes.profiles import router as profiles_router
from routes.social import router as social_router
from routes.social import social as social_follow

PEOPLE = ('alice', 'bob', 'carol')


def auth(user):
    return {'Authorization': f'Bearer {create_access_token({"sub": user})}'}


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / 'blocks.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        for pid in PEOPLE:
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=RoleEnum.SURFER,
                           full_name=f'{pid.title()} Surfer', credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0))
        db.flush()
        for pid in PEOPLE:
            db.add(Post(id=f'post-{pid}', author_id=pid, media_url=f'https://example.invalid/{pid}.jpg',
                        spot_id='spot-1', caption=f'{pid} post'))
        # alice (the blocker) blocked bob. carol is the control: no block with anybody.
        db.add(UserBlock(id='blk-1', blocker_id='alice', blocked_id='bob', reason='harassment'))
        # a conversation that already existed BEFORE the block (the side door: send into an old thread)
        db.add(Conversation(id='conv-ab', participant_one_id='alice', participant_two_id='bob'))
        db.add(Message(id='msg-1', conversation_id='conv-ab', sender_id='alice', content='from before the block'))
        # alice and bob each commented on carol's post (the shared third-party thread).
        db.add(Comment(id='c-alice', post_id='post-carol', author_id='alice', content='alice here'))
        db.add(Comment(id='c-bob', post_id='post-carol', author_id='bob', content='bob here'))
        # carol's own top-level comment with a reply from bob (the reply alice must never see)
        db.add(Comment(id='c-carol', post_id='post-carol', author_id='carol', content='carol here'))
        db.add(Comment(id='c-bob-reply', post_id='post-carol', author_id='bob', parent_id='c-carol', content='bob reply'))
        db.commit()
    sync_engine.dispose()

    engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_db():
        async with maker() as session:
            yield session

    # No push notification may leave the process.
    monkeypatch.setattr(messages_conversations, 'onesignal_service', None)
    monkeypatch.setattr(social_follow, 'onesignal_service', None)
    app = FastAPI()
    for router in (messages_router, posts_router, profiles_router, social_router):
        app.include_router(router, prefix='/api')
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


# The two directions of the one block: alice->bob (the blocker acts) and bob->alice (the blocked acts).
PAIRS = [('bob', 'alice'), ('alice', 'bob')]


# --------------------------------------------------------------------------------------- actions: 403 both ways

@pytest.mark.parametrize('actor,target', PAIRS)
def test_direct_message_is_refused_both_ways(client, actor, target):
    r = client.post('/api/messages/send', params={'sender_id': actor}, headers=auth(actor),
                    json={'recipient_id': target, 'content': 'hello'})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_start_conversation_is_refused_both_ways(client, actor, target):
    r = client.post('/api/messages/start-conversation', params={'sender_id': actor, 'recipient_id': target},
                    headers=auth(actor))
    assert r.status_code == 403, r.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_comment_on_the_others_post_is_refused_both_ways(client, actor, target):
    r = client.post(f'/api/posts/post-{target}/comments', headers=auth(actor), json={'content': 'hi'})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_reply_to_the_others_comment_on_a_third_partys_post_is_refused(client, actor, target):
    r = client.post('/api/posts/post-carol/comments', headers=auth(actor),
                    json={'content': 'reply', 'parent_id': f'c-{target}'})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_like_and_reaction_on_the_others_post_are_refused(client, actor, target):
    like = client.post(f'/api/posts/post-{target}/like', headers=auth(actor))
    assert like.status_code == 403, like.text
    reaction = client.post(f'/api/posts/post-{target}/reactions', headers=auth(actor), json={'emoji': '\U0001F919'})
    assert reaction.status_code == 403, reaction.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_follow_is_refused_both_ways(client, actor, target):
    r = client.post(f'/api/follow/{target}', params={'follower_id': actor}, headers=auth(actor))
    assert r.status_code == 403, r.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_friend_request_is_refused_both_ways(client, actor, target):
    r = client.post('/api/friends/request', params={'requester_id': actor}, headers=auth(actor),
                    json={'addressee_id': target})
    assert r.status_code == 403, r.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_old_thread_is_not_a_side_door(client, actor, target):
    """A conversation that predates the block must not let the pair keep reaching each other."""
    reaction = client.post('/api/messages/react/msg-1', headers=auth(actor), json={'emoji': '🤙'})
    assert reaction.status_code == 403, reaction.text
    voice = client.post('/api/messages/voice-note', headers=auth(actor),
                        data={'duration': '3', 'conversation_id': 'conv-ab', 'sender_id': actor},
                        files={'file': ('v.webm', b'x', 'audio/webm')})
    assert voice.status_code == 403, voice.text
    media = client.post('/api/messages/media', headers=auth(actor),
                        data={'sender_id': actor, 'conversation_id': 'conv-ab'},
                        files={'file': ('p.png', b'x', 'image/png')})
    assert media.status_code == 403, media.text
    new_chat = client.post('/api/messages/media', headers=auth(actor),
                           data={'sender_id': actor, 'recipient_id': target},
                           files={'file': ('p.png', b'x', 'image/png')})
    assert new_chat.status_code == 403, new_chat.text


@pytest.mark.parametrize('actor,target', PAIRS)
def test_comment_reaction_on_the_others_comment_is_refused(client, actor, target):
    r = client.post(f'/api/comments/c-{target}/reactions', headers=auth(actor), json={'emoji': '🤙'})
    assert r.status_code == 403, r.text


# --------------------------------------------------------------------------------------- the control: carol

def test_a_user_with_no_block_is_unaffected_on_every_action(client):
    dm = client.post('/api/messages/send', params={'sender_id': 'carol'}, headers=auth('carol'),
                     json={'recipient_id': 'alice', 'content': 'hello'})
    assert dm.status_code == 200, dm.text
    start = client.post('/api/messages/start-conversation', params={'sender_id': 'carol', 'recipient_id': 'bob'},
                        headers=auth('carol'))
    assert start.status_code == 200, start.text
    comment = client.post('/api/posts/post-alice/comments', headers=auth('carol'), json={'content': 'nice'})
    assert comment.status_code == 200, comment.text
    reply = client.post('/api/posts/post-carol/comments', headers=auth('carol'),
                        json={'content': 'ty', 'parent_id': 'c-bob'})
    assert reply.status_code == 200, reply.text
    like = client.post('/api/posts/post-bob/like', headers=auth('carol'))
    assert like.status_code == 200, like.text
    follow = client.post('/api/follow/alice', params={'follower_id': 'carol'}, headers=auth('carol'))
    assert follow.status_code == 200, follow.text
    friend = client.post('/api/friends/request', params={'requester_id': 'carol'}, headers=auth('carol'),
                         json={'addressee_id': 'bob'})
    assert friend.status_code == 200, friend.text


def test_unblocking_restores_every_action(client):
    assert client.post('/api/follow/alice', params={'follower_id': 'bob'}, headers=auth('bob')).status_code == 403
    unblock = client.post('/api/users/unblock', headers=auth('alice'), json={'blocker_id': 'alice', 'blocked_id': 'bob'})
    assert unblock.status_code == 200, unblock.text
    assert client.post('/api/follow/alice', params={'follower_id': 'bob'}, headers=auth('bob')).status_code == 200
    assert client.post('/api/posts/post-alice/comments', headers=auth('bob'), json={'content': 'hi'}).status_code == 200
    dm = client.post('/api/messages/send', params={'sender_id': 'bob'}, headers=auth('bob'),
                     json={'recipient_id': 'alice', 'content': 'hello'})
    assert dm.status_code == 200, dm.text


def test_blocking_through_the_route_takes_effect_immediately(client):
    """The write path and the read path agree: block carol through the real route, then carol is refused."""
    assert client.post('/api/posts/post-alice/comments', headers=auth('carol'), json={'content': 'ok'}).status_code == 200
    block = client.post('/api/users/block', headers=auth('alice'), json={'blocker_id': 'alice', 'blocked_id': 'carol'})
    assert block.status_code == 200, block.text
    assert client.post('/api/posts/post-alice/comments', headers=auth('carol'), json={'content': 'again'}).status_code == 403


# --------------------------------------------------------------------------------------- views: 404, one way

def test_blocked_viewer_gets_404_on_profile_and_blocker_does_not(client):
    assert client.get('/api/profiles/alice', headers=auth('bob')).status_code == 404
    assert client.get('/api/profiles/by-username/alice', headers=auth('bob')).status_code == 404
    # the blocker can still open the blocked user's page (to unblock), the control and anonymous visitors see both
    assert client.get('/api/profiles/bob', headers=auth('alice')).status_code == 200
    assert client.get('/api/profiles/alice', headers=auth('carol')).status_code == 200
    assert client.get('/api/profiles/by-username/alice', headers=auth('carol')).status_code == 200
    assert client.get('/api/profiles/alice').status_code == 200
    # the blocked viewer's 404 is the very response an unknown profile / username gives
    assert (client.get('/api/profiles/alice', headers=auth('bob')).json()
            == client.get('/api/profiles/no-such-user', headers=auth('bob')).json())
    assert (client.get('/api/profiles/by-username/alice', headers=auth('bob')).json()
            == client.get('/api/profiles/by-username/no_such_user', headers=auth('bob')).json())


def test_blocked_viewer_gets_404_on_the_blockers_posts(client):
    assert client.get('/api/posts/post-alice', headers=auth('bob')).status_code == 404
    assert client.get('/api/profile/alice/posts', headers=auth('bob')).status_code == 404
    assert client.get('/api/posts/post-alice/comments', headers=auth('bob')).status_code == 404
    assert client.get('/api/posts/post-alice', headers=auth('carol')).status_code == 200
    assert client.get('/api/profile/alice/posts', headers=auth('carol')).status_code == 200
    assert client.get('/api/posts/post-alice/comments', headers=auth('carol')).status_code == 200
    # the 404 is the SAME 404 an unknown post gives: the block is not leaked
    assert (client.get('/api/posts/post-alice', headers=auth('bob')).json()
            == client.get('/api/posts/no-such-post', headers=auth('bob')).json())


# --------------------------------------------------------------------------------------- lists: hidden both ways

def _feed_authors(client, user):
    r = client.get('/api/posts', headers=auth(user) if user else {})
    assert r.status_code == 200, r.text
    return {p['author_id'] for p in r.json()['posts']}


def test_feed_hides_the_pair_from_each_other_and_not_from_the_control(client):
    assert _feed_authors(client, 'bob') == {'bob', 'carol'}
    assert _feed_authors(client, 'alice') == {'alice', 'carol'}
    assert _feed_authors(client, 'carol') == set(PEOPLE)
    assert _feed_authors(client, None) == set(PEOPLE)


def test_spot_feed_hides_the_pair_from_each_other(client):
    def authors(user):
        r = client.get('/api/posts/spot/spot-1', headers=auth(user))
        assert r.status_code == 200, r.text
        body = r.json()
        return {p['author_id'] for p in body['photographer_posts'] + body['user_posts']}

    assert authors('bob') == {'bob', 'carol'}
    assert authors('alice') == {'alice', 'carol'}
    assert authors('carol') == set(PEOPLE)


def test_a_spoofed_viewer_id_query_cannot_widen_the_spot_feed(client):
    r = client.get('/api/posts/spot/spot-1', params={'viewer_id': 'carol'}, headers=auth('bob'))
    body = r.json()
    assert 'alice' not in {p['author_id'] for p in body['photographer_posts'] + body['user_posts']}


def test_comment_threads_hide_the_other_side_of_the_block(client):
    def authors(user):
        r = client.get('/api/posts/post-carol/comments', headers=auth(user) if user else {})
        assert r.status_code == 200, r.text
        return {c['author_id'] for c in r.json()}

    assert authors('bob') == {'bob', 'carol'}
    assert authors('alice') == {'alice', 'carol'}
    assert authors('carol') == set(PEOPLE)
    assert authors(None) == set(PEOPLE)


def test_replies_from_the_other_side_of_the_block_are_hidden_too(client):
    def reply_authors(user):
        r = client.get('/api/posts/post-carol/comments', headers=auth(user))
        thread = next(c for c in r.json() if c['id'] == 'c-carol')
        return {rep['author_id'] for rep in thread['replies']}, thread['reply_count']

    assert reply_authors('alice') == (set(), 0)
    assert reply_authors('carol') == ({'bob'}, 1)
    assert reply_authors('bob') == ({'bob'}, 1)


def test_search_never_lists_the_pair_to_each_other(client):
    def ids(path, params, user, key=None):
        r = client.get(path, params=params, headers=auth(user) if user else {})
        assert r.status_code == 200, r.text
        body = r.json()
        rows = body[key] if key else body
        return {u['id'] for u in rows}

    for path, params, key in (('/api/profiles/search', {'q': 'Surfer'}, None),
                              ('/api/users/search', {'query': 'Surfer'}, 'users'),
                              ('/api/users/search-mentions', {'q': 'a'}, None)):
        assert 'alice' not in ids(path, params, 'bob', key), path
        assert 'bob' not in ids(path, params, 'alice', key), path
        assert 'alice' in ids(path, params, 'carol', key), path
        assert 'alice' in ids(path, params, None, key), path
