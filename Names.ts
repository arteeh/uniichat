// a subagent's name: an adjective and an animal, the animal's emoji its
// face (#116); only animals whose emoji are distinct at a small size and
// on older phones (no 🫎 🫏 🪿 🪼, no joined ones like 🐻‍❄️)
const ADJS = `
big small tiny huge giant little tall short long round flat thick thin deep
soft hard smooth rough fuzzy fluffy shiny crunchy crispy leafy spiky hot cold
warm cool icy frosty snowy rainy sunny cloudy windy stormy foggy misty sweet
sour salty spicy juicy minty nutty creamy smoky fresh bright dark quiet loud
happy jolly merry calm brave bold clever wise kind gentle lucky proud quick
swift fast slow eager busy sleepy silly funny shy neat noble grand royal mighty
strong steady nimble lively cozy old young ancient wooden stone paper iron
magic cosmic lunar solar polar wild amber azure bronze copper golden silver
`.split(/\s+/).filter(Boolean);

const ANIMALS: Array<[string, string]> = [
  ["ant", "🐜"], ["badger", "🦡"], ["bat", "🦇"], ["bear", "🐻"], ["beaver", "🦫"], ["bee", "🐝"],
  ["beetle", "🪲"], ["bird", "🐦"], ["bison", "🦬"], ["boar", "🐗"], ["buffalo", "🐃"], ["butterfly", "🦋"],
  ["camel", "🐫"], ["cat", "🐈"], ["caterpillar", "🐛"], ["chick", "🐤"], ["chicken", "🐔"], ["chipmunk", "🐿️"],
  ["cockroach", "🪳"], ["cow", "🐄"], ["crab", "🦀"], ["cricket", "🦗"], ["crocodile", "🐊"], ["deer", "🦌"],
  ["dino", "🦖"], ["dodo", "🦤"], ["dog", "🐕"], ["dolphin", "🐬"], ["dove", "🕊️"], ["dragon", "🐉"],
  ["duck", "🦆"], ["eagle", "🦅"], ["elephant", "🐘"], ["fish", "🐟"], ["flamingo", "🦩"], ["fly", "🪰"],
  ["fox", "🦊"], ["frog", "🐸"], ["giraffe", "🦒"], ["goat", "🐐"], ["gorilla", "🦍"], ["guppy", "🐠"],
  ["hamster", "🐹"], ["hatchling", "🐣"], ["hedgehog", "🦔"], ["hippo", "🦛"], ["horse", "🐎"], ["kangaroo", "🦘"],
  ["koala", "🐨"], ["ladybug", "🐞"], ["leopard", "🐆"], ["lion", "🦁"], ["lizard", "🦎"], ["llama", "🦙"],
  ["lobster", "🦞"], ["mammoth", "🦣"], ["monkey", "🐒"], ["mosquito", "🦟"], ["mouse", "🐁"], ["octopus", "🐙"],
  ["orangutan", "🦧"], ["otter", "🦦"], ["owl", "🦉"], ["ox", "🐂"], ["panda", "🐼"], ["parrot", "🦜"],
  ["peacock", "🦚"], ["penguin", "🐧"], ["pig", "🐖"], ["poodle", "🐩"], ["puffer", "🐡"], ["rabbit", "🐇"],
  ["raccoon", "🦝"], ["ram", "🐏"], ["rat", "🐀"], ["rhino", "🦏"], ["rooster", "🐓"], ["sauropod", "🦕"],
  ["scorpion", "🦂"], ["seal", "🦭"], ["shark", "🦈"], ["sheep", "🐑"], ["shrimp", "🦐"], ["skunk", "🦨"],
  ["sloth", "🦥"], ["snail", "🐌"], ["snake", "🐍"], ["spider", "🕷️"], ["squid", "🦑"], ["swan", "🦢"],
  ["tiger", "🐅"], ["turkey", "🦃"], ["turtle", "🐢"], ["unicorn", "🦄"], ["whale", "🐋"], ["wolf", "🐺"],
  ["worm", "🪱"], ["zebra", "🦓"],
];

export function name_random(): string {
  const adj = ADJS[Math.floor(Math.random() * ADJS.length)];
  const [animal] = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return name_word(adj) + name_word(animal);
}

// the emoji of the animal a name ends with
export function name_face(name: string): string {
  const low = name.toLowerCase();
  const hit = ANIMALS.filter(([animal]) => low.endsWith(animal)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit === undefined ? "🤖" : hit[1];
}

function name_word(word: string): string {
  return word[0].toUpperCase() + word.slice(1);
}
