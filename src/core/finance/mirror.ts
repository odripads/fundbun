import type { FinanceContext, MirrorState, YearMonth } from '../types'

/**
 * The Dream Mirror — FundBun's signature landing hero.
 * status:
 *   'over'      spent > target                                   → "You could've gotten a {item}."
 *   'pace_over' current month, spent <= target but projected > target × 1.05
 *                                                                → "Careful — at this pace you'll trade away {item}."
 *   'under'     past month under target, or current month projected < target × 0.95
 *                                                                → "You're ¥X under — that's {treat}, guilt-free!" or
 *                                                                  "¥X closer to your {goal} (62% there)."
 *   'on_track'  otherwise; 'no_data' when no spending.
 * Item choice: the most expensive dream item fully covered by |delta| (quantity >= 1); if none, the primary
 * goal with `fraction`. Fill goalDelayDays, hoursOfWork, goal progress, mood and a CTA:
 *   over/pace_over → create_tripwire or set_category_budget on the biggest 'want' category;
 *   under → transfer_to_goal of (part of) the surplus.
 * Copy varies by profile.tone (cheeky | gentle | numbers); numbers in copy are formatted with money.fmt.
 */
export function computeMirror(ctx: FinanceContext, month?: YearMonth): MirrorState {
  throw new Error('TODO computeMirror ' + ctx.profile.name + month)
}
