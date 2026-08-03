const memory = require('./memoryService');
const { callLLM } = require('./llmService');

/**
 * Behavior Engine
 * Learns Master Nikhil's habits, coding preferences, tone, and active goals
 */

async function updateBehaviorProfile(userId, message) {
  try {
    const prompt = `Analyze this message from Master Nikhil: "${message}"
Identify any explicit or implicit:
- Working habits / preferences (e.g. night worker, prefers bullet points, uses Node.js/Firebase)
- Active career or project goals
- Communication tone preferences

If any clear habit/preference/goal is found, return it as a short bullet string. Otherwise return NULL.
Strict JSON format: { "trait": string or null }`;

    const { text } = await callLLM({
      role: 'router',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.1,
    });

    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    if (parsed.trait) {
      await memory.addFactUnique(userId, `[Habit/Preference]: ${parsed.trait}`);
    }
  } catch (err) {
    console.error('updateBehaviorProfile error:', err.message);
  }
}

module.exports = {
  updateBehaviorProfile,
};
