/**
 * Shared Emoji Data GÇö Single source of truth for all emoji pickers
 *
 * Three consumers:
 *   1. components/EmojiPicker.js       (feed comments & captions)
 *   2. components/messages/EmojiPicker.js  (DMs)
 *   3. components/CrewChat.js          (crew chat inline picker)
 *
 * DO NOT duplicate emoji arrays in individual components.
 * Import from here instead.
 *
 * UNICODE COMPLIANCE (v99): All emoji use \u{XXXXX} ES2015+ escape sequences.
 * Raw multi-byte emoji corrupt during PowerShell/git operations (see rules.md -º3).
 */

// GöÇGöÇGöÇ Quick-access row (top row, surf-first) GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ
export const QUICK_ACCESS_EMOJIS = ['\u{1F919}', '\u{1F30A}', '\u{1F3C4}', '\u{1F525}', '\u{1F4AF}', '\u{1F64C}', '\u{2764}\u{FE0F}', '\u{1F44F}', '\u{1F60E}', '\u{1F4AA}'];

// GöÇGöÇGöÇ Reaction emojis for post/comment/message reactions GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ
// SYNC CONTRACT: Must match backend/routes/posts/schemas.py GåÆ VALID_REACTIONS
// Verified in-sync v103: both lists are 10 identical codepoints in the same order.
// If you add/remove an emoji here, update VALID_REACTIONS in the backend too.
// Curated for surf culture: Shaka, Wave, Surfer, Fire, 100, Heart,
// Clap, Laugh, Stoked-face, Flexed-biceps.
export const REACTION_EMOJIS = ['\u{1F919}', '\u{1F30A}', '\u{1F3C4}', '\u{1F525}', '\u{1F4AF}', '\u{2764}\u{FE0F}', '\u{1F44F}', '\u{1F602}', '\u{1F60E}', '\u{1F4AA}'];

// GöÇGöÇGöÇ Primary categories (always visible) GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ
// Surf-first ordering, consistent across all pickers.
export const EMOJI_CATEGORIES = {
  'Surf & Ocean': [
    '\u{1F30A}', '\u{1F3C4}', '\u{1F3C4}\u{200D}\u{2642}\u{FE0F}', '\u{1F3C4}\u{200D}\u{2640}\u{FE0F}', '\u{1F919}', '\u{1F334}', '\u{2600}\u{FE0F}', '\u{1F41A}',
    '\u{1F988}', '\u{1F42C}', '\u{1F420}', '\u{1F3DD}\u{FE0F}', '\u{26F1}\u{FE0F}', '\u{1F305}', '\u{1F31E}', '\u{1F991}',
    '\u{1F419}', '\u{1F980}', '\u{1F433}', '\u{1F9AD}', '\u{1F421}', '\u{1FAB8}', '\u{2693}', '\u{1F6A4}',
    '\u{1F6F6}', '\u{1FABC}', '\u{1F40B}', '\u{1F990}',
  ],
  'Reactions': [
    '\u{1F525}', '\u{1F4AF}', '\u{2764}\u{FE0F}', '\u{1F44F}', '\u{1F64C}', '\u{1F60D}', '\u{1F929}', '\u{1F60E}',
    '\u{1F4AA}', '\u{1F44A}', '\u{2728}', '\u{2B50}', '\u{1F3AF}', '\u{1F3C6}', '\u{1F947}', '\u{1F4A5}',
    '\u{1F4AB}', '\u{1F680}', '\u{1F389}', '\u{1F973}', '\u{1F480}', '\u{1FAE1}', '\u{1FAF6}', '\u{1F485}',
    '\u{1F92F}', '\u{1F624}', '\u{1F91D}', '\u{1FAF0}',
  ],
  'Faces': [
    '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}', '\u{1F605}', '\u{1F923}', '\u{1F602}',
    '\u{1F642}', '\u{1F60A}', '\u{1F607}', '\u{1F970}', '\u{1F60D}', '\u{1F929}', '\u{1F618}', '\u{1F617}',
    '\u{1F61A}', '\u{1F60B}', '\u{1F61B}', '\u{1F61C}', '\u{1F92A}', '\u{1F61D}', '\u{1F911}', '\u{1F917}',
    '\u{1F92D}', '\u{1F92B}', '\u{1F914}', '\u{1F910}', '\u{1F928}', '\u{1F610}', '\u{1F611}', '\u{1F636}',
    '\u{1F60F}', '\u{1F612}', '\u{1F644}', '\u{1F62C}', '\u{1F62E}\u{200D}\u{1F4A8}', '\u{1F925}', '\u{1F60C}', '\u{1F614}',
    '\u{1F62A}', '\u{1F924}', '\u{1F634}', '\u{1F637}', '\u{1F912}', '\u{1F915}', '\u{1F922}', '\u{1F92E}',
    '\u{1F974}', '\u{1F635}', '\u{1F635}\u{200D}\u{1F4AB}', '\u{1F920}', '\u{1F973}', '\u{1F978}', '\u{1F60E}', '\u{1F9D0}',
    '\u{1F631}', '\u{1F628}', '\u{1F630}', '\u{1F625}', '\u{1F622}', '\u{1F62D}', '\u{1F624}', '\u{1F621}',
  ],
  'Gestures': [
    '\u{1F44D}', '\u{1F44E}', '\u{1F44C}', '\u{1F90C}', '\u{1F90F}', '\u{270C}\u{FE0F}', '\u{1F91E}', '\u{1F91F}',
    '\u{1F918}', '\u{1F919}', '\u{1F448}', '\u{1F449}', '\u{1F446}', '\u{1F447}', '\u{261D}\u{FE0F}', '\u{1F44B}',
    '\u{1F91A}', '\u{1F590}\u{FE0F}', '\u{270B}', '\u{1F596}', '\u{1F44F}', '\u{1F64C}', '\u{1F91D}', '\u{1F64F}',
    '\u{1F4AA}', '\u{1F9BE}', '\u{1FAF5}', '\u{1FAF1}', '\u{1FAF2}', '\u{1FAF3}', '\u{1FAF4}', '\u{1FAF0}',
  ],
  'Nature': [
    '\u{1F338}', '\u{1F33A}', '\u{1F33B}', '\u{1F33C}', '\u{1F337}', '\u{1F339}', '\u{1F331}', '\u{1F33F}',
    '\u{1F340}', '\u{1F343}', '\u{1F342}', '\u{1F341}', '\u{1F33E}', '\u{1F335}', '\u{1F38B}', '\u{1F38D}',
    '\u{1F333}', '\u{1F332}', '\u{1F334}', '\u{1F384}', '\u{1FAB7}', '\u{1FAB7}', '\u{1FAB9}', '\u{1F344}',
  ],
  'Weather': [
    '\u{1F324}\u{FE0F}', '\u{26C5}', '\u{1F325}\u{FE0F}', '\u{2601}\u{FE0F}', '\u{1F326}\u{FE0F}', '\u{1F327}\u{FE0F}', '\u{26C8}\u{FE0F}', '\u{1F329}\u{FE0F}',
    '\u{1F328}\u{FE0F}', '\u{2744}\u{FE0F}', '\u{1F32C}\u{FE0F}', '\u{1F4A8}', '\u{1F32A}\u{FE0F}', '\u{1F32B}\u{FE0F}', '\u{1F308}', '\u{2600}\u{FE0F}',
    '\u{1F319}', '\u{2B50}', '\u{1F31F}', '\u{1F4AB}', '\u{1F506}', '\u{1F315}', '\u{1F311}', '\u{1F313}',
  ],
};

// GöÇGöÇGöÇ Extended categories (collapsible "Show More" section) GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ
// These appear when the user expands the picker.
export const EXTENDED_EMOJI_CATEGORIES = {
  'Animals': [
    '\u{1F436}', '\u{1F431}', '\u{1F42D}', '\u{1F439}', '\u{1F430}', '\u{1F98A}', '\u{1F43B}', '\u{1F43C}',
    '\u{1F428}', '\u{1F42F}', '\u{1F981}', '\u{1F42E}', '\u{1F437}', '\u{1F438}', '\u{1F435}', '\u{1F414}',
    '\u{1F427}', '\u{1F426}', '\u{1F985}', '\u{1F986}', '\u{1F989}', '\u{1F434}', '\u{1F984}', '\u{1F41D}',
    '\u{1F41B}', '\u{1F98B}', '\u{1F40C}', '\u{1F41E}', '\u{1F422}', '\u{1F40D}', '\u{1F98E}', '\u{1F982}',
  ],
  'Food & Drink': [
    '\u{1F34E}', '\u{1F350}', '\u{1F34A}', '\u{1F34B}', '\u{1F34C}', '\u{1F349}', '\u{1F347}', '\u{1F353}',
    '\u{1FAD0}', '\u{1F351}', '\u{1F96D}', '\u{1F34D}', '\u{1F965}', '\u{1F951}', '\u{1F354}', '\u{1F355}',
    '\u{1F32E}', '\u{1F32F}', '\u{1F957}', '\u{1F363}', '\u{1F371}', '\u{1F369}', '\u{1F36A}', '\u{1F382}',
    '\u{1F36B}', '\u{1F37F}', '\u{2615}', '\u{1F375}', '\u{1F9CB}', '\u{1F964}', '\u{1F37A}', '\u{1F377}',
  ],
  'Activities': [
    '\u{26BD}', '\u{1F3C0}', '\u{1F3C8}', '\u{26BE}', '\u{1F94E}', '\u{1F3BE}', '\u{1F3D0}', '\u{1F3C9}',
    '\u{1F94F}', '\u{1F3B1}', '\u{1F3D3}', '\u{1F3F8}', '\u{1F3D2}', '\u{1F94A}', '\u{1F3BF}', '\u{1F6F9}',
    '\u{1F6FC}', '\u{1F3CA}', '\u{1F3CA}\u{200D}\u{2642}\u{FE0F}', '\u{1F3CA}\u{200D}\u{2640}\u{FE0F}', '\u{1F6B4}', '\u{1F9D7}', '\u{1F938}', '\u{1F3CB}\u{FE0F}',
    '\u{26F7}\u{FE0F}', '\u{1F3C2}', '\u{1FA82}', '\u{1F93F}', '\u{1F3A3}', '\u{1F9D8}', '\u{1FA98}', '\u{1F3B5}',
  ],
  'Travel & Places': [
    '\u{1F697}', '\u{1F695}', '\u{1F68C}', '\u{1F68E}', '\u{1F3CE}\u{FE0F}', '\u{1F693}', '\u{1F691}', '\u{1F692}',
    '\u{2708}\u{FE0F}', '\u{1F680}', '\u{1F6F8}', '\u{1F681}', '\u{26F5}', '\u{1F6A4}', '\u{1F6E5}\u{FE0F}', '\u{1F6F3}\u{FE0F}',
    '\u{1F5FC}', '\u{1F5FD}', '\u{26E9}\u{FE0F}', '\u{1F54C}', '\u{1F6D5}', '\u{26EA}', '\u{1F3F0}', '\u{1F3EF}',
    '\u{1F3D6}\u{FE0F}', '\u{1F3D5}\u{FE0F}', '\u{1F30B}', '\u{1F5FB}', '\u{1F3D4}\u{FE0F}', '\u{1F5FA}\u{FE0F}', '\u{1F9ED}', '\u{26FA}',
  ],
  'Objects': [
    '\u{1F4F1}', '\u{1F4BB}', '\u{2328}\u{FE0F}', '\u{1F5A5}\u{FE0F}', '\u{1F4F7}', '\u{1F4F8}', '\u{1F4F9}', '\u{1F3A5}',
    '\u{1F3AC}', '\u{1F4FA}', '\u{1F399}\u{FE0F}', '\u{1F3A7}', '\u{1F3A4}', '\u{1F3B8}', '\u{1F941}', '\u{1F3B9}',
    '\u{1F3BA}', '\u{1F3BB}', '\u{1F4FF}', '\u{1F48E}', '\u{1F52E}', '\u{1F9FF}', '\u{1FAAC}', '\u{1F381}',
    '\u{1F388}', '\u{1F380}', '\u{1FAA9}', '\u{1F3C5}', '\u{1F396}\u{FE0F}', '\u{1F3C6}', '\u{1F4CC}', '\u{1F511}',
  ],
  'Symbols': [
    '\u{2764}\u{FE0F}', '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F5A4}', '\u{1F90D}',
    '\u{1F90E}', '\u{1F494}', '\u{2763}\u{FE0F}', '\u{1F495}', '\u{1F49E}', '\u{1F493}', '\u{1F497}', '\u{1F496}',
    '\u{1F498}', '\u{1F49D}', '\u{262E}\u{FE0F}', '\u{271D}\u{FE0F}', '\u{262A}\u{FE0F}', '\u{1F549}\u{FE0F}', '\u{2638}\u{FE0F}', '\u{2721}\u{FE0F}',
    '\u{267B}\u{FE0F}', '\u{26A0}\u{FE0F}', '\u{1F531}', '\u{1F4DB}', '\u{1F530}', '\u{2B55}', '\u{2705}', '\u{274C}',
    '\u{2753}', '\u{2757}', '\u{203C}\u{FE0F}', '\u{2049}\u{FE0F}', '\u{1F4A4}', '\u{1F4A2}', '\u{1F4AC}', '\u{1F441}\u{FE0F}\u{200D}\u{1F5E8}\u{FE0F}',
  ],
  'Flags': [
    '\u{1F3F3}\u{FE0F}', '\u{1F3F4}', '\u{1F3C1}', '\u{1F6A9}', '\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}', '\u{1F3F3}\u{FE0F}\u{200D}\u{26A7}\u{FE0F}', '\u{1F3F4}\u{200D}\u{2620}\u{FE0F}',
    '\u{1F1FA}\u{1F1F8}', '\u{1F1E7}\u{1F1F7}', '\u{1F1E6}\u{1F1FA}', '\u{1F1F5}\u{1F1F9}', '\u{1F1EE}\u{1F1E9}', '\u{1F1EF}\u{1F1F5}', '\u{1F1FF}\u{1F1E6}',
    '\u{1F1EB}\u{1F1F7}', '\u{1F1EA}\u{1F1F8}', '\u{1F1F2}\u{1F1FD}', '\u{1F1E8}\u{1F1F7}', '\u{1F1F5}\u{1F1EA}', '\u{1F1E8}\u{1F1F1}', '\u{1F1F3}\u{1F1FF}',
    '\u{1F1ED}\u{1F1EE}', '\u{1F1F5}\u{1F1ED}', '\u{1F1F9}\u{1F1ED}', '\u{1F1F1}\u{1F1F0}', '\u{1F1F2}\u{1F1FB}', '\u{1F1EB}\u{1F1EF}', '\u{1F1EC}\u{1F1E7}',
  ],
};

// GöÇGöÇGöÇ Convenience: all categories merged (for full-picker views) GöÇGöÇ
export const ALL_EMOJI_CATEGORIES = {
  ...EMOJI_CATEGORIES,
  ...EXTENDED_EMOJI_CATEGORIES,
};

// GöÇGöÇGöÇ Category icons (for tab display in pickers) GöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇGöÇ
export const CATEGORY_ICONS = {
  'Surf & Ocean': '\u{1F3C4}',
  'Reactions':    '\u{1F525}',
  'Faces':        '\u{1F600}',
  'Gestures':     '\u{1F919}',
  'Nature':       '\u{1F338}',
  'Weather':      '\u{1F324}\u{FE0F}',
  'Animals':      '\u{1F436}',
  'Food & Drink': '\u{1F355}',
  'Activities':   '\u{26BD}',
  'Travel & Places': '\u{2708}\u{FE0F}',
  'Objects':      '\u{1F4F1}',
  'Symbols':      '\u{2764}\u{FE0F}',
  'Flags':        '\u{1F3F3}\u{FE0F}',
};
