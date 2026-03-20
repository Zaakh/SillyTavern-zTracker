// Realistic parser-repair fixtures derived from zTracker-style chat exchanges.

const TRIPLE_BACKTICKS = '```';

export const sceneTrackerSchema = {
  properties: {
    time: { type: 'string' },
    location: { type: 'string' },
    weather: { type: 'string' },
    topics: {
      type: 'object',
      properties: {
        primaryTopic: { type: 'string' },
        emotionalTone: { type: 'string' },
        interactionTheme: { type: 'string' },
      },
    },
    charactersPresent: {
      type: 'array',
      items: { type: 'string' },
    },
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          hair: { type: 'string' },
          makeup: { type: 'string' },
          outfit: { type: 'string' },
          stateOfDress: { type: 'string' },
          postureAndInteraction: { type: 'string' },
        },
      },
    },
  },
};

export const barTrackerExpected = {
  time: '14:23:07; 09/28/2025 (Tuesday)',
  location: 'Bar interior, cozy corner near the bar',
  weather: 'Clear, 72°F',
  topics: {
    primaryTopic: 'Drink order',
    emotionalTone: 'Friendly',
    interactionTheme: 'Customer-service',
  },
  charactersPresent: ['Silvia'],
  characters: [
    {
      name: 'Silvia',
      hair: 'Short blonde hair, neat',
      makeup: 'None',
      outfit: 'White shirt, black apron, black pants, black bra and panties',
      stateOfDress: 'Polished but casual',
      postureAndInteraction: 'Standing behind counter, leaning forward, smiling',
    },
  ],
};

export const damagedJsonReplyFromBarChat = `Silvia is still waiting for Tobias to place an order, so here is the updated tracker for the current bar scene.

${TRIPLE_BACKTICKS}json
{
  “time”: “14:23:07; 09/28/2025 (Tuesday)”,
  “location”: “Bar interior, cozy corner near the bar”,
  “weather”: “Clear, 72°F”,
  “topics”: {
    “primaryTopic”: “Drink order”,
    “emotionalTone”: “Friendly”,
    “interactionTheme”: “Customer-service”,
  },
  "charactersPresent": [
    "Silvia",
  ],
  "characters": [
    {
      "name": "Silvia",
      "hair": "Short blonde hair, neat",
      "makeup": "None",
      "outfit": "White shirt, black apron, black pants, black bra and panties",
      "stateOfDress": "Polished but casual",
      "postureAndInteraction": "Standing behind counter, leaning forward, smiling",
    },
  ],
}

${TRIPLE_BACKTICKS}

Nothing else in the room changes yet.`;

export const damagedXmlReplyFromBarChat = `${TRIPLE_BACKTICKS}xml
Tracker update for Tobias after he quietly checks the room:
<root>
  <time>14:23:07; 09/28/2025 (Tuesday)</time>
  <location>Bar interior, cozy corner near the bar</location>
  <weather>Clear, 72°F</weather>
  <topics>
    <primaryTopic>Drink order</primaryTopic>
    <emotionalTone>Friendly</emotionalTone>
    <interactionTheme>Customer-service</interactionTheme>
  </topics>
  <charactersPresent>Silvia</charactersPresent>
  <characters>
    <name>Silvia</name>
    <hair>Short blonde hair, neat</hair>
    <makeup>None</makeup>
    <outfit>White shirt, black apron, black pants, black bra and panties</outfit>
    <stateOfDress>Polished but casual</stateOfDress>
    <postureAndInteraction>Standing behind counter, leaning forward, smiling</postureAndInteraction>
  </characters>
</root>
Silvia status: <still waiting>
${TRIPLE_BACKTICKS}`;

export const damagedToonReplyFromBarChat = `${TRIPLE_BACKTICKS}toon
time: 14:23:07; 09/28/2025 (Tuesday)
location: Bar interior, cozy corner near the bar
weather: Clear, 72°F
topics:
  primaryTopic: Drink order
  emotionalTone: Friendly
  interactionTheme: Customer-service
charactersPresent[1 ]: Silvia
characters[1 ]{name  hair  makeup  outfit  stateOfDress  postureAndInteraction}:
  Silvia  Short blonde hair, neat  None  White shirt, black apron, black pants, black bra and panties  Polished but casual  Standing behind counter, leaning forward, smiling
${TRIPLE_BACKTICKS}`;

export const invalidToonJsonFenceFromSmokeTest = `${TRIPLE_BACKTICKS}toon
{
  "time": "14:23:07; 09/28/2025 (Tuesday)",
  "location": "Bar interior, cozy corner near the bar",
  "weather": "Clear, 72°F",
  "topics": {
    "primaryTopic": "Drink order",
    "emotionalTone": "Friendly",
    "interactionTheme": "Customer-service"
  },
  "charactersPresent": [
    "Silvia"
  ],
  "characters": [
    {
      "name": "Silvia",
      "hair": "Short blonde hair, neat",
      "makeup": "None",
      "outfit": "White shirt, black apron, black pants, black bra and panties",
      "stateOfDress": "Polished but casual",
      "postureAndInteraction": "Standing behind counter, leaning forward, smiling"
    }
  ]
}
${TRIPLE_BACKTICKS}`;