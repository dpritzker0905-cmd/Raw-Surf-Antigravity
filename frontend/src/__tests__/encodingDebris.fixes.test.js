/**
 * Focused regressions for the places where da30f15d's debris was not cosmetic -- it changed what
 * the app DID. encodingDebris.guard.test.js keeps the shapes out; these pin the behaviour back.
 *
 *   crew chat   getFileIcon returned '=' for every type; the auto-caption check compared against
 *               debris, so it never matched the backend's paperclip prefix.
 *   reactions   SinglePost's quick-tap shaka sent '=' (backend VALID_REACTIONS rejects it).
 *   notes       both note pickers inserted a literal '=' into the user's note.
 *   lineup      every notification title read "= Session Opened" / "G Payment Pending".
 *   maths       "$50/hr + 2 hrs" where the lost glyph was a times sign.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { parse } from '@babel/parser';

import {
  getFileIcon, QUICK_ACTIONS, FILE_MESSAGE_AUTO_PREFIX,
} from '../components/messages/crewChatUtils';
import { NOTE_EMOJIS, REACTION_EMOJIS } from '../constants/emojis';
import CreateNoteModal from '../components/messages/CreateNoteModal';
import { ProfileNoteModal } from '../components/ProfileNoteModal';
import PotentialEarningsCalculator from '../components/sessions/PotentialEarningsCalculator';
import { handleLineupNotification } from '../services/LineupNotifications';
import { toast } from 'sonner';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));

const SRC = path.join(__dirname, '..');
const REPO = path.join(SRC, '..', '..');
const readRepo = (rel) => fs.readFileSync(path.join(REPO, ...rel.split('/')), 'utf8');

// Decode Python '\U0001F919' / '❤' escapes into the string they denote.
const pyUnescape = (s) => s.replace(/\\U([0-9a-fA-F]{8})|\\u([0-9a-fA-F]{4})/g,
  (_, big, small) => String.fromCodePoint(parseInt(big || small, 16)));

describe('crew chat file messages', () => {
  test.each([
    ['application/pdf'], ['application/msword'], ['spreadsheet'], ['presentation'],
    ['application/zip'], ['text/csv'], ['image/heic'], [undefined],
  ])('getFileIcon(%s) renders a decorative svg, never a glyph string', (type) => {
    const icon = getFileIcon(type);
    expect(typeof icon).toBe('object');
    const { container } = render(icon);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(container.textContent).toBe('');
  });

  test('the auto-caption prefix is the paperclip the backend actually writes', () => {
    expect(FILE_MESSAGE_AUTO_PREFIX).toBe(String.fromCodePoint(0x1F4CE));
    const backend = readRepo('backend/routes/crew/crew_chat_media.py');
    const m = backend.match(/message_content = caption if caption else f"(\\U[0-9a-fA-F]{8}) \{original_name\}"/);
    expect(m).not.toBeNull();
    expect(pyUnescape(m[1])).toBe(FILE_MESSAGE_AUTO_PREFIX);
  });

  test('CrewChat hides the auto-caption through the shared constant, not a literal', () => {
    const src = fs.readFileSync(path.join(SRC, 'components', 'CrewChat.js'), 'utf8');
    expect(src).toContain('!msg.content.startsWith(FILE_MESSAGE_AUTO_PREFIX)');
  });

  test('quick actions are clean sentences (they are sent verbatim as messages)', () => {
    expect(QUICK_ACTIONS.length).toBe(20);
    expect(new Set(QUICK_ACTIONS.map((a) => a.id)).size).toBe(QUICK_ACTIONS.length);
    for (const a of QUICK_ACTIONS) {
      expect(a.text).toMatch(/^[A-Za-z0-9][A-Za-z0-9 '/,.!-]*$/);
      expect(a).not.toHaveProperty('icon');
    }
  });
});

describe('reactions', () => {
  test('REACTION_EMOJIS still matches backend VALID_REACTIONS', () => {
    const schemas = readRepo('backend/routes/posts/schemas.py');
    const m = schemas.match(/VALID_REACTIONS = \[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const backend = m[1].split(',').map((s) => pyUnescape(s.trim().replace(/^'|'$/g, '')));
    expect(REACTION_EMOJIS).toEqual(backend);
  });

  test('every literal passed to a reaction handler is a reaction the backend accepts', () => {
    const calls = [];
    const walkDir = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['__tests__', 'node_modules', 'testMocks'].includes(e.name)) walkDir(p); continue; }
        if (!/\.js$/.test(e.name) || /\.test\.js$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8');
        if (!/handleReaction\(/.test(src)) continue;
        const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'] });
        const visit = (n) => {
          if (!n || typeof n.type !== 'string') return;
          if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'handleReaction') {
            for (const a of n.arguments) if (a.type === 'StringLiteral') calls.push([path.relative(SRC, p), a.loc.start.line, a.value]);
          }
          for (const k of Object.keys(n)) {
            if (k === 'loc') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach((c) => c && typeof c === 'object' && visit(c));
            else if (v && typeof v === 'object') visit(v);
          }
        };
        visit(ast.program);
      }
    };
    walkDir(SRC);
    // Anti-vacuity: SinglePost, PostModal (x2), CommentWithReaction, ReplyItem, the feed hook,
    // usePostModal -- 7 literal call sites at the time of writing.
    expect(calls.length).toBeGreaterThanOrEqual(7);
    const bad = calls.filter(([, , v]) => !REACTION_EMOJIS.includes(v));
    expect(bad).toEqual([]);
  });
});

describe('note emoji pickers insert emoji, not debris', () => {
  test('NOTE_EMOJIS is the 12 distinct glyphs the pickers shipped with', () => {
    expect(NOTE_EMOJIS).toHaveLength(12);
    expect(new Set(NOTE_EMOJIS).size).toBe(12);
    for (const e of NOTE_EMOJIS) expect(e).toMatch(/\p{Extended_Pictographic}/u);
    expect(NOTE_EMOJIS[0]).toBe(String.fromCodePoint(0x1F919));
  });

  test('CreateNoteModal: clicking a picker button appends that emoji to the note', () => {
    render(<CreateNoteModal isOpen onClose={jest.fn()} onSubmit={jest.fn()} />);
    const input = screen.getByTestId('note-input');
    expect(input.getAttribute('placeholder')).toBe("What's on your mind?");
    const buttons = screen.getByTestId('note-emoji-picker').querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(NOTE_EMOJIS);
    fireEvent.click(buttons[2]);
    expect(input.value).toBe(NOTE_EMOJIS[2]);
    expect(buttons[2].getAttribute('aria-label')).toBe(`Add ${NOTE_EMOJIS[2]}`);
  });

  test('ProfileNoteModal: the picker offers the same emoji and passes them through', () => {
    const setNoteText = jest.fn();
    render(
      <ProfileNoteModal
        isOpen onClose={jest.fn()} isOwnProfile profileName="Kai" userNote={null}
        noteText="" setNoteText={setNoteText} noteSubmitting={false}
        onCreateNote={jest.fn()} onDeleteNote={jest.fn()}
      />,
    );
    const buttons = screen.getByTestId('emoji-picker').querySelectorAll('button');
    expect(Array.from(buttons).map((b) => b.textContent)).toEqual(NOTE_EMOJIS);
    fireEvent.click(buttons[0]);
    const updater = setNoteText.mock.calls[0][0];
    expect(updater('Dawn patrol ')).toBe(`Dawn patrol ${NOTE_EMOJIS[0]}`);
  });
});

describe('lineup notifications', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['session_opened', 'success', 'Session Opened'],
    ['crew_removed', 'error', 'Removed from Lineup'],
    ['payment_pending', 'warning', 'Payment Pending'],
    ['invite_declined', 'info', 'Invite Declined'],
  ])('%s toasts its plain title', (type, variant, title) => {
    handleLineupNotification(type, { session_name: 'Dawn Patrol' }, { soundEnabled: false, pushEnabled: false });
    expect(toast[variant]).toHaveBeenCalledTimes(1);
    expect(toast[variant].mock.calls[0][0]).toBe(title);
  });
});

describe('arithmetic reads as arithmetic', () => {
  test('the earnings breakdown multiplies with a times sign, not a plus', () => {
    render(
      <PotentialEarningsCalculator
        buyinPrice={25} maxSurfers={4} photoPrice={10} estimatedPhotosPerSurfer={5}
        textPrimaryClass="" textSecondaryClass=""
      />,
    );
    expect(screen.getByText('Buy-ins (4 × $25)')).toBeInTheDocument();
    expect(screen.getByText('Photo sales (est. 5/surfer × $10)')).toBeInTheDocument();
  });
});
