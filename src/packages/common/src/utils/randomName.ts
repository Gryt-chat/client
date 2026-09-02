/**
 * A name for an install that has not been given one.
 *
 * The alternative was "Unknown", and it was wrong twice over: a guest arrived
 * on every server called "Unknown", and the generated avatar is seeded on the
 * name, so everybody who had not set one shared a face. A random word fixes
 * both — it is something to be called, and it is different per install.
 * GRYT-846.
 *
 * The list is deliberately dull. These names go in front of strangers on
 * somebody else's server, they are read aloud in voice chat, and whoever gets
 * one did not choose it — so nothing here should be a joke that lands badly, a
 * word that means something else somewhere, or anything a person would mind
 * being called for the ten seconds before they change it.
 *
 * **This is a copy of the mobile app's `src/profile/randomName.ts`.** The two
 * clients should hand out names from the same pool, and there is nowhere to put
 * it yet that both can import — `@gryt/crypto` is the only thing they already
 * share. Change one, change the other. GRYT-847.
 *
 * Only nouns, only English, and nothing that reads as a real person's name.
 * A stranger arriving as "Marcus" looks like a claim about who they are;
 * "Bandit" looks like what it is, which is a placeholder.
 */

/**
 * Gems, metals, animals, weather, sky, and a few playful roles.
 *
 * Long enough that a room of thirty rarely doubles up, which is the whole
 * reason for the size — two people called Ruby in a member list is exactly the
 * confusion the old shared "Unknown" caused.
 */
export const NAME_POOL = [
  // Gems and minerals
  "Ruby", "Emerald", "Diamond", "Sapphire", "Topaz", "Opal", "Amber", "Jade",
  "Onyx", "Pearl", "Quartz", "Garnet", "Amethyst", "Turquoise", "Obsidian",
  "Marble", "Granite", "Flint", "Slate", "Crystal",

  // Metals
  "Gold", "Silver", "Copper", "Bronze", "Iron", "Steel", "Cobalt", "Pewter",
  "Platinum", "Titanium", "Brass", "Nickel",

  // Animals
  "Shark", "Turtle", "Otter", "Falcon", "Heron", "Badger", "Lynx", "Bison",
  "Walrus", "Puffin", "Osprey", "Marten", "Ibex", "Tapir", "Gecko", "Manta",
  "Narwhal", "Pelican", "Raven", "Magpie", "Sparrow", "Kestrel", "Weasel",
  "Beaver", "Moose", "Elk", "Stoat", "Hedgehog", "Mongoose", "Meerkat",
  "Albatross", "Barnacle", "Urchin", "Cuttlefish", "Seal", "Puma", "Ocelot",
  "Caribou", "Wombat", "Numbat", "Quokka", "Capybara",

  // Roles, playful
  "Sheriff", "Bandit", "Captain", "Ranger", "Scout", "Pilot", "Sailor",
  "Miner", "Baker", "Cooper", "Mason", "Tinker", "Herald", "Envoy", "Courier",
  "Gardener", "Lookout", "Skipper", "Wrangler", "Drifter",

  // Weather and sky
  "Comet", "Nebula", "Quasar", "Aurora", "Meteor", "Eclipse", "Zenith",
  "Thunder", "Cyclone", "Monsoon", "Blizzard", "Drizzle", "Gale", "Frost",
  "Ember", "Cinder", "Vapour", "Mistral", "Zephyr", "Squall",

  // Landscape
  "Canyon", "Fjord", "Glacier", "Delta", "Mesa", "Tundra", "Prairie", "Dune",
  "Reef", "Atoll", "Summit", "Ridge", "Hollow", "Meadow", "Thicket", "Bramble",
  "Harbour", "Lagoon", "Cove", "Cascade",

  // Plants
  "Cedar", "Juniper", "Willow", "Birch", "Aspen", "Alder", "Hazel", "Bracken",
  "Clover", "Fennel", "Sorrel", "Nettle", "Thistle", "Heather", "Saffron",
  "Cardamom", "Chicory", "Marigold",
] as const;

/**
 * One name from the pool.
 *
 * `Math.random` on purpose. This picks something to be called, not a secret —
 * the identity is a keypair, and the name has never been part of it. Reaching
 * for the crypto RNG here would suggest otherwise.
 */
export function pickRandomName(): string {
  return NAME_POOL[Math.floor(Math.random() * NAME_POOL.length)];
}
