// Static emoji catalogue for the chat composer picker.
// No dependency, no network fetch — plain arrays of characters.

export type EmojiCategory = { name: string; emojis: string[] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: "Smileys",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😍", "🥰", "😘", "😜", "🤪", "🤗", "🤔", "🤨",
      "😐", "😴", "😢", "😭", "😤", "😡", "🥺", "😳", "🤯", "😎",
    ],
  },
  {
    name: "Gestures",
    emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤙", "👋", "🙌", "👏", "🙏", "💪", "🤝", "☝️", "✋"],
  },
  {
    name: "Hearts",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💖", "💕", "💯"],
  },
  {
    name: "Animals",
    emojis: ["🐶", "🐱", "🐭", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐵", "🦄"],
  },
  {
    name: "Food",
    emojis: ["🍎", "🍌", "🍇", "🍉", "🍕", "🍔", "🍟", "🌮", "🍜", "🍣", "🍩", "🍪", "🎂", "☕", "🍵", "🍺"],
  },
  {
    name: "Activity",
    emojis: ["⚽", "🏀", "🏏", "🎾", "🏸", "🎮", "🎯", "🎲", "🎧", "🎤", "🎸", "🏆", "🚴", "🧘"],
  },
  {
    name: "Objects",
    emojis: ["📱", "💻", "📷", "🔋", "💡", "🔑", "🎁", "📚", "✏️", "📝", "💰", "🛒", "🕒", "🚗", "✈️", "🏠"],
  },
  {
    name: "Symbols",
    emojis: ["✅", "❌", "❗", "❓", "⚠️", "🔥", "✨", "🌟", "🎉", "🎊", "💤", "🔔", "🚀", "🌈", "☀️", "🌙"],
  },
];
