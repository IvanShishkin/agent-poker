import { z } from 'zod'

// ---------- Primitives ----------

/** Card as '<rank><suit>', e.g. 'As', 'Td', '2c'. Ranks: 23456789TJQKA, suits: shdc. */
export const CardSchema = z.string().regex(/^[2-9TJQKA][shdc]$/)
export type Card = z.infer<typeof CardSchema>

export const MoveSchema = z.enum(['fold', 'check', 'call', 'raise'])
export type Move = z.infer<typeof MoveSchema>

export const StreetSchema = z.enum(['preflop', 'flop', 'turn', 'river', 'showdown', 'complete'])
export type Street = z.infer<typeof StreetSchema>

// ---------- Agent -> Server ----------

export const JoinMsg = z.object({
  type: z.literal('join'),
  name: z.string().min(1).max(32),
  /** Reconnect token from a previous `joined` message. Tolerates null from naive clients. */
  token: z.string().nullish(),
})

export const SubscribeMsg = z.object({
  type: z.literal('subscribe'),
})

export const ActionMsg = z.object({
  type: z.literal('action'),
  handId: z.string(),
  /** Must echo `seq` from the `your_turn` message — guards against acting on stale state. */
  seq: z.number().int(),
  move: MoveSchema,
  /** For raise: total amount to raise TO for this street (not the increment). */
  amount: z.number().int().positive().nullish(),
})

export const ReasoningMsg = z.object({
  type: z.literal('reasoning'),
  handId: z.string(),
  text: z.string().max(500),
})

/** Free-form table talk, not tied to a turn — broadcast to spectators AND other players. */
export const SayMsg = z.object({
  type: z.literal('say'),
  text: z.string().min(1).max(200),
})

export const ClientMsg = z.discriminatedUnion('type', [JoinMsg, SubscribeMsg, ActionMsg, ReasoningMsg, SayMsg])
export type ClientMsg = z.infer<typeof ClientMsg>

// ---------- Server -> Agent / Spectator ----------

export const PublicPlayerSchema = z.object({
  seat: z.number().int(),
  name: z.string(),
  chips: z.number().int(),
  /** Committed to the pot on the current street. */
  bet: z.number().int(),
  folded: z.boolean(),
  allIn: z.boolean(),
  sittingOut: z.boolean(),
  connected: z.boolean(),
  /** Hole cards: present only in spectator stream (god view) or for yourself in `hand_start`. */
  holeCards: z.array(CardSchema).length(2).optional(),
})
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>

export const JoinedMsg = z.object({
  type: z.literal('joined'),
  seat: z.number().int(),
  chips: z.number().int(),
  /** Save this to reconnect onto the same seat. */
  token: z.string(),
  tableConfig: z.object({
    smallBlind: z.number().int(),
    bigBlind: z.number().int(),
    turnTimeoutMs: z.number().int(),
    maxSeats: z.number().int(),
  }),
})

export const HandStartMsg = z.object({
  type: z.literal('hand_start'),
  handId: z.string(),
  button: z.number().int(),
  smallBlind: z.number().int(),
  bigBlind: z.number().int(),
  /** Your own cards (agent stream) or everyone's via players[].holeCards (spectator stream). */
  holeCards: z.array(CardSchema).length(2).optional(),
  players: z.array(PublicPlayerSchema),
})

export const StateMsg = z.object({
  type: z.literal('state'),
  handId: z.string(),
  seq: z.number().int(),
  street: StreetSchema,
  board: z.array(CardSchema),
  pot: z.number().int(),
  currentBet: z.number().int(),
  toAct: z.number().int().nullable(),
  players: z.array(PublicPlayerSchema),
  /** The action that produced this state, if any. */
  lastAction: z
    .object({ seat: z.number().int(), move: MoveSchema, amount: z.number().int().optional() })
    .optional(),
})
export type StateMsg = z.infer<typeof StateMsg>

export const YourTurnMsg = z.object({
  type: z.literal('your_turn'),
  handId: z.string(),
  seq: z.number().int(),
  validMoves: z.array(MoveSchema),
  /** Amount needed to call (already capped by your stack). */
  toCall: z.number().int(),
  /** Raise-to bounds; null when raising is not allowed. */
  minRaiseTo: z.number().int().nullable(),
  maxRaiseTo: z.number().int().nullable(),
  timeoutMs: z.number().int(),
})
export type YourTurnMsg = z.infer<typeof YourTurnMsg>

export const HandEndMsg = z.object({
  type: z.literal('hand_end'),
  handId: z.string(),
  board: z.array(CardSchema),
  /** Gross winnings per seat (key = seat number as string). */
  payouts: z.record(z.string(), z.number().int()),
  /** Net result per seat for this hand (payout - contributed). */
  net: z.record(z.string(), z.number().int()),
  /** Revealed hands at showdown; absent when everyone folded. */
  showdown: z
    .array(
      z.object({
        seat: z.number().int(),
        holeCards: z.array(CardSchema).length(2),
        handName: z.string(),
      }),
    )
    .optional(),
  players: z.array(PublicPlayerSchema),
})

export const ReasoningEventMsg = z.object({
  type: z.literal('reasoning_event'),
  handId: z.string(),
  seat: z.number().int(),
  name: z.string(),
  text: z.string(),
})

/** Table talk from a player; unlike reasoning_event it is also sent to the other players. */
export const ChatEventMsg = z.object({
  type: z.literal('chat_event'),
  seat: z.number().int(),
  name: z.string(),
  text: z.string(),
})

export const ErrorMsg = z.object({
  type: z.literal('error'),
  code: z.enum([
    'invalid_action',
    'not_your_turn',
    'stale_seq',
    'bad_message',
    'table_full',
    'name_taken',
    'invalid_invite',
  ]),
  message: z.string(),
})

export const ServerMsg = z.discriminatedUnion('type', [
  JoinedMsg,
  HandStartMsg,
  StateMsg,
  YourTurnMsg,
  HandEndMsg,
  ReasoningEventMsg,
  ChatEventMsg,
  ErrorMsg,
])
export type ServerMsg = z.infer<typeof ServerMsg>

export type JoinedMsgT = z.infer<typeof JoinedMsg>
export type HandStartMsgT = z.infer<typeof HandStartMsg>
export type HandEndMsgT = z.infer<typeof HandEndMsg>
export type YourTurnMsgT = z.infer<typeof YourTurnMsg>
export type StateMsgT = z.infer<typeof StateMsg>
export type ReasoningEventMsgT = z.infer<typeof ReasoningEventMsg>
export type ChatEventMsgT = z.infer<typeof ChatEventMsg>
export type ErrorMsgT = z.infer<typeof ErrorMsg>

export function parseClientMsg(raw: unknown): ClientMsg {
  return ClientMsg.parse(typeof raw === 'string' ? JSON.parse(raw) : raw)
}

export function parseServerMsg(raw: unknown): ServerMsg {
  return ServerMsg.parse(typeof raw === 'string' ? JSON.parse(raw) : raw)
}
