export const profileAvatars = [
  { key: 'bear', symbol: '🐻', name: '곰' },
  { key: 'cat', symbol: '🐱', name: '고양이' },
  { key: 'fox', symbol: '🦊', name: '여우' },
  { key: 'dog', symbol: '🐶', name: '강아지' },
  { key: 'rabbit', symbol: '🐰', name: '토끼' },
  { key: 'panda', symbol: '🐼', name: '판다' },
  { key: 'penguin', symbol: '🐧', name: '펭귄' },
  { key: 'owl', symbol: '🦉', name: '부엉이' },
  { key: 'frog', symbol: '🐸', name: '개구리' },
  { key: 'turtle', symbol: '🐢', name: '거북이' },
  { key: 'apple', symbol: '🍎', name: '사과' },
  { key: 'cherry', symbol: '🍒', name: '체리' },
  { key: 'lemon', symbol: '🍋', name: '레몬' },
  { key: 'peach', symbol: '🍑', name: '복숭아' },
  { key: 'strawberry', symbol: '🍓', name: '딸기' },
  { key: 'grape', symbol: '🍇', name: '포도' },
  { key: 'watermelon', symbol: '🍉', name: '수박' },
  { key: 'banana', symbol: '🍌', name: '바나나' },
  { key: 'pineapple', symbol: '🍍', name: '파인애플' },
  { key: 'kiwi', symbol: '🥝', name: '키위' },
]

export function profileAvatar(key) {
  return profileAvatars.find((item) => item.key === key) ?? profileAvatars[0]
}
