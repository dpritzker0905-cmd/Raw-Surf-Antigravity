/**
 * Shared Emoji Data — Single source of truth for all emoji pickers
 *
 * Three consumers:
 *   1. components/EmojiPicker.js       (feed comments & captions)
 *   2. components/messages/EmojiPicker.js  (DMs)
 *   3. components/CrewChat.js          (crew chat inline picker)
 *
 * DO NOT duplicate emoji arrays in individual components.
 * Import from here instead.
 */

// ─── Quick-access row (top row, surf-first) ──────────────────────
export const QUICK_ACCESS_EMOJIS = ['🤙', '🌊', '🏄', '🔥', '💯', '🙌', '❤️', '👏', '😎', '💪'];

// ─── Reaction emojis for post/comment/message reactions ──────────
// Used by Feed.js, PostCard.js, PostModal.js, CrewChat, and messages.
// Curated for surf culture: Shaka, Wave, Surfer, Fire, 100, Heart,
// Clap, Laugh, Stoked-face, Flexed-biceps.
export const REACTION_EMOJIS = ['🤙', '🌊', '🏄', '🔥', '💯', '❤️', '👏', '😂', '😎', '💪'];

// ─── Primary categories (always visible) ─────────────────────────
// Surf-first ordering, consistent across all pickers.
export const EMOJI_CATEGORIES = {
  'Surf & Ocean': [
    '🌊', '🏄', '🏄‍♂️', '🏄‍♀️', '🤙', '🌴', '☀️', '🐚',
    '🦈', '🐬', '🐠', '🏝️', '⛱️', '🌅', '🌞', '🦑',
    '🐙', '🦀', '🐳', '🦭', '🐡', '🪸', '⚓', '🚤',
    '🛶', '🪼', '🐋', '🦐',
  ],
  'Reactions': [
    '🔥', '💯', '❤️', '👏', '🙌', '😍', '🤩', '😎',
    '💪', '👊', '✨', '⭐', '🎯', '🏆', '🥇', '💥',
    '💫', '🚀', '🎉', '🥳', '💀', '🫡', '🫶', '💅',
    '🤯', '😤', '🤝', '🫰',
  ],
  'Faces': [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
    '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗',
    '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗',
    '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶',
    '😏', '😒', '🙄', '😬', '😮‍💨', '🤥', '😌', '😔',
    '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
    '🥴', '😵', '😵‍💫', '🤠', '🥳', '🥸', '😎', '🧐',
    '😱', '😨', '😰', '😥', '😢', '😭', '😤', '😡',
  ],
  'Gestures': [
    '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
    '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👋',
    '🤚', '🖐️', '✋', '🖖', '👏', '🙌', '🤝', '🙏',
    '💪', '🦾', '🫵', '🫱', '🫲', '🫳', '🫴', '🫰',
  ],
  'Nature': [
    '🌸', '🌺', '🌻', '🌼', '🌷', '🌹', '🌱', '🌿',
    '🍀', '🍃', '🍂', '🍁', '🌾', '🌵', '🎋', '🎍',
    '🌳', '🌲', '🌴', '🎄', '🪻', '🪷', '🪹', '🍄',
  ],
  'Weather': [
    '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️',
    '🌨️', '❄️', '🌬️', '💨', '🌪️', '🌫️', '🌈', '☀️',
    '🌙', '⭐', '🌟', '💫', '🔆', '🌕', '🌑', '🌓',
  ],
};

// ─── Extended categories (collapsible "Show More" section) ────────
// These appear when the user expands the picker.
export const EXTENDED_EMOJI_CATEGORIES = {
  'Animals': [
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
    '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
    '🐧', '🐦', '🦅', '🦆', '🦉', '🐴', '🦄', '🐝',
    '🐛', '🦋', '🐌', '🐞', '🐢', '🐍', '🦎', '🦂',
  ],
  'Food & Drink': [
    '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓',
    '🫐', '🍑', '🥭', '🍍', '🥥', '🥑', '🍔', '🍕',
    '🌮', '🌯', '🥗', '🍣', '🍱', '🍩', '🍪', '🎂',
    '🍫', '🍿', '☕', '🍵', '🧋', '🥤', '🍺', '🍷',
  ],
  'Activities': [
    '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉',
    '🥏', '🎱', '🏓', '🏸', '🏒', '🥊', '🎿', '🛹',
    '🛼', '🏊', '🏊‍♂️', '🏊‍♀️', '🚴', '🧗', '🤸', '🏋️',
    '⛷️', '🏂', '🪂', '🤿', '🎣', '🧘', '🪘', '🎵',
  ],
  'Travel & Places': [
    '🚗', '🚕', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒',
    '✈️', '🚀', '🛸', '🚁', '⛵', '🚤', '🛥️', '🛳️',
    '🗼', '🗽', '⛩️', '🕌', '🛕', '⛪', '🏰', '🏯',
    '🏖️', '🏕️', '🌋', '🗻', '🏔️', '🗺️', '🧭', '⛺',
  ],
  'Objects': [
    '📱', '💻', '⌨️', '🖥️', '📷', '📸', '📹', '🎥',
    '🎬', '📺', '🎙️', '🎧', '🎤', '🎸', '🥁', '🎹',
    '🎺', '🎻', '📿', '💎', '🔮', '🧿', '🪬', '🎁',
    '🎈', '🎀', '🪩', '🏅', '🎖️', '🏆', '📌', '🔑',
  ],
  'Symbols': [
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
    '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
    '💘', '💝', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️',
    '♻️', '⚠️', '🔱', '📛', '🔰', '⭕', '✅', '❌',
    '❓', '❗', '‼️', '⁉️', '💤', '💢', '💬', '👁️‍🗨️',
  ],
  'Flags': [
    '🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🏴‍☠️',
    '🇺🇸', '🇧🇷', '🇦🇺', '🇵🇹', '🇮🇩', '🇯🇵', '🇿🇦',
    '🇫🇷', '🇪🇸', '🇲🇽', '🇨🇷', '🇵🇪', '🇨🇱', '🇳🇿',
    '🇭🇮', '🇵🇭', '🇹🇭', '🇱🇰', '🇲🇻', '🇫🇯', '🇬🇧',
  ],
};

// ─── Convenience: all categories merged (for full-picker views) ──
export const ALL_EMOJI_CATEGORIES = {
  ...EMOJI_CATEGORIES,
  ...EXTENDED_EMOJI_CATEGORIES,
};

// ─── Category icons (for tab display in pickers) ─────────────────
export const CATEGORY_ICONS = {
  'Surf & Ocean': '🏄',
  'Reactions':    '🔥',
  'Faces':        '😀',
  'Gestures':     '🤙',
  'Nature':       '🌸',
  'Weather':      '🌤️',
  'Animals':      '🐶',
  'Food & Drink': '🍕',
  'Activities':   '⚽',
  'Travel & Places': '✈️',
  'Objects':      '📱',
  'Symbols':      '❤️',
  'Flags':        '🏳️',
};
