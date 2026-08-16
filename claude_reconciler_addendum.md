# Addendum: Claude Reconciliation Layer for Itinerary Edits

This slots into the existing Gemini + Firebase + Maps architecture. Gemini keeps doing what
it's good at — grounded research via Maps function calling. Claude's only job is turning a
decision made in that chat into a validated, structured edit against the itinerary schema —
including the messier cases (multiple stops confirmed in one message, edits, removals,
ambiguous references) that a regex on a fixed string can't reliably catch.

```
┌────────────────────────────────────────────────────────┐
│                   Frontend Client                      │
└─────────────────────────┬──────────────────────────────┘
                          │ 1. User Chat Input
                          ▼
┌────────────────────────────────────────────────────────┐
│                   Backend API Router                   │
└──────┬───────────────────────┬──────────────┬──────────┘
       │ 2. Prompt + Tools     │ 4. Places API │ 5. Reconcile turn
       ▼                       ▼               ▼
┌──────────────┐    ┌────────────────────┐  ┌───────────────────┐
│ Gemini Flash  │    │  Google Maps       │  │  Claude Haiku 4.5 │
│ (research)    │    │  (Places/Routes)   │  │  (structured edit)│
└──────────────┘    └────────────────────┘  └─────────┬─────────┘
                                                        │ 6. Validated JSON diff
                                                        ▼
                                              ┌────────────────────┐
                                              │ Firebase (itinerary)│
                                              └────────────────────┘
```

Claude only runs when there's something to reconcile — not on every turn. Easiest trigger:
run it whenever Gemini's reply contains anything that looks like a decision (a `Confirmed:`
line, or just always run it on turns where the user's message reads like a choice rather than
a question — Claude can make that judgment call itself, see below).

---

## Tool Schema: `apply_itinerary_change`

Unlike the Gemini doc's confirmation format, this handles **add / move / remove / edit** in one
schema, and supports multiple changes per call — so "let's do the Buc-ee's and skip the
aquarium" produces two edits, not one silently dropped.

```json
{
  "name": "apply_itinerary_change",
  "description": "Applies one or more validated changes to the family road trip itinerary based on a decision the user made in conversation.",
  "input_schema": {
    "type": "object",
    "properties": {
      "changes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": ["add", "move", "remove", "edit"]
            },
            "stopId": {
              "type": "string",
              "description": "Existing stop's id for move/remove/edit. Omit for add."
            },
            "name": { "type": "string" },
            "day": { "type": "integer", "description": "1-indexed day of the trip." },
            "position": { "type": "integer", "description": "Order within that day, 0-indexed." },
            "time": { "type": "string", "description": "Rough time, e.g. '2:00 PM' or 'morning'." },
            "address": { "type": "string" },
            "lat": { "type": "number" },
            "lng": { "type": "number" },
            "notes": { "type": "string" }
          },
          "required": ["action"]
        }
      },
      "confidence": {
        "type": "string",
        "enum": ["high", "low"],
        "description": "Low if the user's decision was ambiguous and should be shown to them for confirmation before applying."
      }
    },
    "required": ["changes", "confidence"]
  }
}
```

---

## System Prompt

```text
You are a reconciliation step in a family road trip planning app. You will be given:
1. The current itinerary as JSON.
2. A snippet of conversation between the user and a research assistant, in which the user
   made a decision (or several) about the trip.

Your only job is to call apply_itinerary_change with the edit(s) implied by that decision.
Do not chat, explain, or add commentary — only call the tool.

Rules:
- One tool call, with one entry in "changes" per distinct decision. If the user confirmed two
  stops in the same message, that's two entries.
- If the user's intent is genuinely ambiguous (unclear day, unclear whether they mean to add
  a new stop or move an existing one), still make your best-guess call, but set
  confidence to "low" so the app can ask the user to confirm before committing it.
- Never invent an address or coordinates that weren't in the conversation or the current
  itinerary. Leave the field out rather than guess.
- If nothing in the snippet constitutes an actual decision, call the tool with an empty
  "changes" array.
```

---

## Node.js Handler

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RECONCILER_SYSTEM_PROMPT = `...`; // paste the block above

interface ItineraryChange {
  action: 'add' | 'move' | 'remove' | 'edit';
  stopId?: string;
  name?: string;
  day?: number;
  position?: number;
  time?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
}

async function reconcileItineraryChanges(
  currentItinerary: unknown,
  conversationSnippet: string
): Promise<{ changes: ItineraryChange[]; confidence: 'high' | 'low' }> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', // narrow, well-defined task — Haiku is a good fit
    max_tokens: 1024,
    system: RECONCILER_SYSTEM_PROMPT,
    tools: [
      {
        name: 'apply_itinerary_change',
        description:
          'Applies one or more validated changes to the family road trip itinerary based on a decision the user made in conversation.',
        input_schema: {
          type: 'object',
          properties: {
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string', enum: ['add', 'move', 'remove', 'edit'] },
                  stopId: { type: 'string' },
                  name: { type: 'string' },
                  day: { type: 'integer' },
                  position: { type: 'integer' },
                  time: { type: 'string' },
                  address: { type: 'string' },
                  lat: { type: 'number' },
                  lng: { type: 'number' },
                  notes: { type: 'string' },
                },
                required: ['action'],
              },
            },
            confidence: { type: 'string', enum: ['high', 'low'] },
          },
          required: ['changes', 'confidence'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'apply_itinerary_change' }, // force the tool call, no prose
    messages: [
      {
        role: 'user',
        content: `Current itinerary:\n${JSON.stringify(currentItinerary)}\n\nConversation snippet:\n${conversationSnippet}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    return { changes: [], confidence: 'low' };
  }

  return toolUse.input as { changes: ItineraryChange[]; confidence: 'high' | 'low' };
}

export { reconcileItineraryChanges };
```

Wire this into the same `/api/chat` route from the Gemini doc: after Gemini responds, pass the
last couple of turns to `reconcileItineraryChanges`. If `confidence` is `"high"`, apply the
changes to Firebase directly; if `"low"`, surface a "Claude thinks you meant X — confirm?"
prompt in the UI instead of applying it silently.

---

## Updated Cost Line

| Service / Feature | Free Tier Allowance | Paid Rates | Best Use Case in Project |
| :--- | :--- | :--- | :--- |
| **Claude Haiku 4.5** | $5 free credit on signup, no card required | $1 / 1M input tokens, $5 / 1M output tokens | Reconciling confirmed decisions into structured itinerary edits — small, frequent calls, low cost per call. |
| **Claude Sonnet 5** *(optional upgrade)* | — | $2 / 1M input, $10 / 1M output (introductory rate through Aug 31, 2026; reverts to $3/$15 after) | Fallback if reconciliation needs to reason over long, tangled chat history rather than a short recent snippet. |

Haiku 4.5 should comfortably handle this task — it's a narrow extraction job, not open-ended
reasoning, and each call is cheap since you're only sending a short conversation snippet plus
the itinerary JSON, not the whole chat history. Move up to Sonnet 5 only if you see the
reconciler mis-parsing multi-stop or ambiguous turns in practice.
