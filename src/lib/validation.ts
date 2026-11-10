import { z } from 'zod';

/** Every server input is validated with these schemas (spec §14). */

export const uuidSchema = z.string().uuid();
export const tableCodeSchema = z
  .string()
  .min(10, 'Invalid table code')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid table code');

export const ratingSchema = z.number().int().min(1).max(5);

export const cartAddSchema = z.object({
  menuItemId: uuidSchema,
  qty: z.number().int().min(1).max(50).default(1),
  notes: z.string().max(200).optional(),
});

export const cartUpdateSchema = z.object({
  cartItemId: uuidSchema,
  qty: z.number().int().min(0).max(50),
});

export const cartRemoveSchema = z.object({ cartItemId: uuidSchema });

export const sendOrderSchema = z.object({
  notes: z.string().max(300).optional(),
});

export const waiterCallSchema = z.object({
  type: z.enum(['call', 'bill']),
});

export const orderDecisionSchema = z.object({
  orderId: uuidSchema,
  action: z.enum(['confirm', 'reject', 'preparing', 'ready', 'served']),
  reason: z.string().max(200).optional(),
});

export const closeSessionSchema = z.object({ sessionId: uuidSchema, reason: z.string().max(200).optional() });

export const reviewSchema = z.object({
  rating: ratingSchema,
  routedTo: z.enum(['google', 'private']),
});

export const feedbackSchema = z.object({
  rating: ratingSchema.optional(),
  message: z.string().min(3, 'Please tell us a little more').max(1000),
  contact: z.string().max(120).optional(),
});

export const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
});

export const categorySchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional().nullable(),
  emoji: z.string().max(8).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});

export const menuItemSchema = z
  .object({
    id: uuidSchema.optional(),
    categoryId: uuidSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(400).optional().nullable(),
    price: z.number().min(0).max(100000),
    offerPrice: z.number().min(0).max(100000).optional().nullable(),
    offerStart: z.string().datetime().optional().nullable(),
    offerEnd: z.string().datetime().optional().nullable(),
    isAvailable: z.boolean().default(true),
    isVeg: z.boolean().default(true),
    imageUrl: z.string().url().max(500).optional().nullable(),
    spiceLevel: z.number().int().min(0).max(3).default(0),
    prepMinutes: z.number().int().min(1).max(180).default(10),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .refine((v) => !v.offerPrice || v.offerPrice < v.price, {
    message: 'Offer price must be lower than the normal price',
    path: ['offerPrice'],
  });

export const soldOutSchema = z.object({ itemId: uuidSchema, isAvailable: z.boolean() });

export const tableSchema = z.object({
  id: uuidSchema.optional(),
  number: z.number().int().min(1).max(999),
  label: z.string().max(60).optional().nullable(),
  seats: z.number().int().min(1).max(30).default(4),
  zone: z.string().max(40).optional().nullable(),
  isActive: z.boolean().default(true),
});

export const staffSchema = z.object({
  email: z.string().email().max(160),
  fullName: z.string().min(2).max(80),
  role: z.enum(['admin', 'waiter', 'kitchen']),
  password: z.string().min(8).max(200),
});

export const staffUpdateSchema = z.object({
  id: uuidSchema,
  fullName: z.string().min(2).max(80).optional(),
  role: z.enum(['admin', 'waiter', 'kitchen']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

/** Staff changing their own password: the current one is always required. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

/** Admin approving or rejecting a staff password request. */
export const passwordDecisionSchema = z.object({
  id: uuidSchema,
  note: z.string().max(200).optional(),
});

/**
 * Waiter-issued table code. 4-6 digits, leading zeros allowed, so it is a string.
 * Anything else (letters, spaces like "12 34", SQL) never reaches the verifier and
 * therefore never counts as an attempt (test B4/B11).
 */
export const verifyOtpSchema = z.object({
  table_code: z.string().min(6).max(64),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,6}$/, 'Enter the 4-digit code your waiter gave you.'),
});

export const otpDismissSchema = z.object({
  otpId: uuidSchema,
  reason: z.string().max(120).optional(),
});

/** G2 — "New party" on a table (waiter and admin both use this). */
export const newPartySchema = z.object({
  tableId: uuidSchema,
});

export const otpRaiseSchema = z.object({
  tableId: uuidSchema,
});

export const settingsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  logoUrl: z.string().url().max(500).optional().nullable(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #e85d2a')
    .optional(),
  wifiSsid: z.string().max(64).optional().nullable(),
  wifiPassword: z.string().max(64).optional().nullable(),
  googleReviewUrl: z.string().url().max(500).optional().nullable(),
  instagramUrl: z.string().url().max(300).optional().nullable(),
  facebookUrl: z.string().url().max(300).optional().nullable(),
  websiteUrl: z.string().url().max(300).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  taxPercent: z.number().min(0).max(30).optional(),
  serviceChargePercent: z.number().min(0).max(20).optional(),
  sounds: z
    .object({
      new_order: z.string().max(20),
      waiter_call: z.string().max(20),
      bill_request: z.string().max(20),
      order_ready: z.string().max(20),
      otp_request: z.string().max(20).optional(),
    })
    .optional(),
  otp: z
    .object({
      length: z.number().int().min(4).max(6).optional(),
      windowMinutes: z.number().int().min(3).max(30).optional(),
      maxAttempts: z.number().int().min(3).max(10).optional(),
      cooldownSeconds: z.number().int().min(0).max(300).optional(),
      maxDevices: z.number().int().min(4).max(20).optional(),
      idleMinutes: z.number().int().min(30).max(240).optional(),
      maxHours: z.number().int().min(1).max(8).optional(),
      autoConfirmOrders: z.boolean().optional(),
      menuPreview: z.boolean().optional(),
    })
    .optional(),
  games: z
    .object({
      roundsPerRound: z.number().int().min(5).max(20).optional(),
      restaurantRoundIntervalMinutes: z.number().int().min(1).max(60).optional(),
      speedBonusMax: z.number().int().min(0).max(200).optional(),
      speedBonusWindowMs: z.number().int().min(2000).max(30000).optional(),
      pointsCorrect: z.number().int().min(10).max(1000).optional(),
      pointsMode: z.enum(['sum', 'average']).optional(),
      showPrizes: z.boolean().optional(),
    })
    .optional(),
});

export const quizCategorySchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().min(1).max(60),
  emoji: z.string().max(8).optional().nullable(),
  sortOrder: z.number().int().min(0).max(99).default(0),
  isActive: z.boolean().default(true),
});

export const quizQuestionSchema = z.object({
  id: uuidSchema.optional(),
  categoryId: uuidSchema,
  question: z.string().min(5).max(300),
  options: z.array(z.string().min(1).max(120)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().max(300).optional().nullable(),
  difficulty: z.number().int().min(1).max(3).default(1),
  isActive: z.boolean().default(true),
});

export const prizeSchema = z.object({
  rank: z.number().int().min(1).max(20),
  title: z.string().min(1).max(80),
  description: z.string().max(200).optional().nullable(),
  isActive: z.boolean().default(true),
});

// ---------------------------------------------------------------- games
export const startGameSchema = z.object({
  mode: z.enum(['solo', 'table', 'restaurant']),
  categoryId: uuidSchema.optional().nullable(),
});

export const answerSchema = z.object({
  roundId: uuidSchema,
  questionIndex: z.number().int().min(0).max(50),
  selectedIndex: z.number().int().min(0).max(3),
  /** solo only. Table and whole-restaurant games are timed by the server. */
  msTaken: z.number().int().min(0).max(120000).optional(),
});

export const joinRoundSchema = z.object({
  roundId: uuidSchema,
  displayName: z.string().min(1).max(24).optional(),
});

/** A guest quits a "with my table" round. */
export const leaveRoundSchema = z.object({
  roundId: uuidSchema,
});

export const createRestaurantRoundSchema = z.object({
  categoryId: uuidSchema.optional().nullable(),
  questionCount: z.number().int().min(5).max(20).default(10),
  startsInSeconds: z.number().int().min(0).max(600).default(60),
});

export const bulkQuestionsSchema = z.object({
  categoryId: uuidSchema,
  csv: z.string().min(10).max(200000),
});

export type MenuItemInput = z.infer<typeof menuItemSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type AnswerInput = z.infer<typeof answerSchema>;
