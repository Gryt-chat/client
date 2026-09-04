/* The channel scope matrix moved to @gryt/core.

   Both apps had a copy and had quietly disagreed: this one joined a cell's role
   and permission with a NUL and the phone used a space. Neither was broken,
   because nothing in Gryt has a space in either half, but only one of the two
   separators is safe from that. The package keeps the NUL, written as a
   `\u0000` escape rather than the raw byte this file used to hold — two literal
   NULs in here were enough for git to call the file binary. */
export {
  type CellState,
  cellState,
  type ChannelRule,
  CUSTOM_VALUE,
  describeRules,
  EVERYONE_VALUE,
  indexRules,
  nextCellState,
  type RuleEffect,
  type ScopeChoice,
  scopeChoiceFromValue,
  scopeChoiceValue,
  scopeOptions,
  scopeSetPayload,
  withCell,
} from "@gryt/core";
